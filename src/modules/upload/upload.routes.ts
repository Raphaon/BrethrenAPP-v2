import path from 'path';
import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { UploadAssetKind } from '@prisma/client';

// Verification des magic bytes pour rejeter les fichiers avec MIME forge
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF header
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'video/mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at offset 4
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
];

function validateMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  // Les types non listés (docx, xlsx, video/webm, video/quicktime) ont des signatures
  // variables - on leur fait confiance via multer fileFilter uniquement
  const signatures = MAGIC_BYTES.filter((m) => m.mime === declaredMime);
  if (signatures.length === 0) return true; // pas de signature connue = on accepte

  return signatures.some(({ bytes, offset = 0 }) => {
    if (buffer.length < offset + bytes.length) return false;
    return bytes.every((byte, i) => buffer[offset + i] === byte);
  });
}
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { isNationalAdmin } from '../../middlewares/rbac.middleware';
import { AppError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { storageService } from '../../services/storage.service';

const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  message: { success: false, message: 'Trop de téléversements, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

function resolveUploadKind(mimeType: string): UploadAssetKind {
  if (mimeType.startsWith('image/')) return UploadAssetKind.IMAGE;
  if (mimeType.startsWith('video/')) return UploadAssetKind.VIDEO;
  return UploadAssetKind.DOCUMENT;
}

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_FILE_MB = Number(process.env['MAX_FILE_SIZE_MB'] ?? 5);

// Multer en mémoire — le fichier est ensuite transmis au storage service
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(
      new AppError(
        'Type de fichier non autorisé. Images, vidéos, PDF et documents Word/Excel uniquement.',
        400,
        'INVALID_FILE_TYPE'
      )
    );
  },
});

router.use(authenticate);

// ─── Liste des assets uploadés par l'utilisateur ──────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kind } = req.query as Record<string, string | undefined>;
    const { page, limit, skip } = req.pagination!;

    const where = {
      uploadedById: req.user!.id,
      deletedAt: null,
      ...(kind && { kind: kind as UploadAssetKind }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.uploadAsset.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.uploadAsset.count({ where }),
    ]);

    sendPaginated(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

// ─── Upload d'un fichier ───────────────────────────────────────────────
router.post(
  '/',
  uploadRateLimit,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err) => {
      if (err) { next(err); return; }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError('Aucun fichier fourni', 400, 'FILE_REQUIRED');

      // Verification des magic bytes — rejette les fichiers avec un MIME type forge
      if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
        throw new AppError(
          'Le contenu du fichier ne correspond pas au type declare. Fichier refuse.',
          400,
          'INVALID_FILE_CONTENT',
        );
      }

      const extension = path.extname(req.file.originalname).toLowerCase();
      const key = `${randomUUID()}${extension}`;

      const { url } = await storageService.upload(key, req.file.buffer, req.file.mimetype);

      const asset = await prisma.uploadAsset.create({
        data: {
          uploadedById: req.user!.id,
          originalName: req.file.originalname,
          fileName: key,
          mimeType: req.file.mimetype,
          size: req.file.size,
          kind: resolveUploadKind(req.file.mimetype),
          url,
        },
      });

      await createAuditLog({
        actorId: req.user!.id,
        action: 'CREATE',
        entityType: 'UploadAsset',
        entityId: asset.id,
        metadata: { kind: asset.kind, mimeType: asset.mimeType, size: asset.size },
        req,
      });

      sendCreated(res, asset, 'Fichier téléversé');
    } catch (err) {
      next(err);
    }
  }
);

// ─── Téléchargement protégé (authentifié) ─────────────────────────────
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Les admins nationaux peuvent télécharger n'importe quel fichier
    const ownerFilter = isNationalAdmin(req.user!) ? {} : { uploadedById: req.user!.id };
    const asset = await prisma.uploadAsset.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...ownerFilter },
    });

    if (!asset) throw new AppError('Fichier introuvable', 404, 'NOT_FOUND');

    const { stream, contentType } = await storageService.getStream(asset.fileName);

    res.setHeader('Content-Type', contentType ?? asset.mimeType);
    // Sanitiser le filename : supprimer les guillemets et retours chariot pour eviter
    // l'injection dans le header Content-Disposition (RFC 6266)
    const safeFilename = asset.originalName.replace(/["\r\n]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeFilename)}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`
    );
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// ─── Suppression logique d'un asset ───────────────────────────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await prisma.uploadAsset.findFirst({
      where: { id: req.params['id'], uploadedById: req.user!.id, deletedAt: null },
    });

    if (!asset) throw new AppError('Fichier introuvable', 404, 'NOT_FOUND');

    await prisma.uploadAsset.update({
      where: { id: asset.id },
      data: { deletedAt: new Date() },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
