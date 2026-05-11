import crypto from 'crypto';
import { Router } from 'express';
import { AnnouncementLevel, NewsPostStatus, NewsPostType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { AppError, ForbiddenError, NotFoundError } from '../../middlewares/error.middleware';
import { notifyUsers } from '../../utils/notify.util';
import { createCommentsRouter } from '../comments/comments.routes';
import { userHasPermission } from '../../middlewares/rbac.middleware';
import {
  assertAnnouncementTargetScope,
  assertEntityMatchesScope,
  buildNewsPostVisibilityFilter,
} from '../../utils/scope-access.util';

const newsMediaSchema = z.object({
  url: z.string().min(1),
  type: z.enum(['IMAGE', 'VIDEO']),
  assetId: z.string().uuid().optional().nullable(),
  caption: z.string().trim().max(160).optional().nullable(),
  thumbnailUrl: z.string().min(1).optional().nullable(),
});

const createNewsPostSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    content: z.string().trim().max(10000).optional().nullable(),
    type: z.nativeEnum(NewsPostType).optional(),
    status: z.nativeEnum(NewsPostStatus).optional(),
    level: z.nativeEnum(AnnouncementLevel),
    regionId: z.string().uuid().optional().nullable(),
    districtId: z.string().uuid().optional().nullable(),
    assemblyId: z.string().uuid().optional().nullable(),
    ministryId: z.string().uuid().optional().nullable(),
    media: z.array(newsMediaSchema).max(10).optional(),
    allowComments: z.boolean().optional(),
    featured: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.content?.trim() && !data.media?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ajoutez un texte, une image ou une video',
        path: ['content'],
      });
    }
  });

const updateNewsPostSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    content: z.string().trim().max(10000).optional().nullable(),
    type: z.nativeEnum(NewsPostType).optional(),
    media: z.array(newsMediaSchema).max(10).optional(),
    allowComments: z.boolean().optional(),
    featured: z.boolean().optional(),
  })
  .strict();

const router = Router();
router.use(authenticate);
router.use('/:id/comments', requirePermission(PERMISSIONS.NEWS_READ), createCommentsRouter('news'));

function assertNewsTargetShape(input: {
  level: AnnouncementLevel;
  regionId?: string | null;
  districtId?: string | null;
  assemblyId?: string | null;
  ministryId?: string | null;
}) {
  if (input.level === 'NATIONAL') {
    if (input.regionId || input.districtId || input.assemblyId || input.ministryId) {
      throw new AppError('Une actualite nationale ne doit pas cibler une entite locale', 400, 'INVALID_SCOPE');
    }
    return;
  }

  if (input.level === 'REGIONAL' && !input.regionId) {
    throw new AppError('Choisissez une region pour cette actualite', 400, 'REGION_REQUIRED');
  }

  if (input.level === 'DISTRICT' && !input.districtId) {
    throw new AppError('Choisissez un district pour cette actualite', 400, 'DISTRICT_REQUIRED');
  }

  if (input.level === 'ASSEMBLY' && !input.assemblyId) {
    throw new AppError('Choisissez une assemblee pour cette actualite', 400, 'ASSEMBLY_REQUIRED');
  }

  if (input.level === 'MINISTRY' && !input.ministryId) {
    throw new AppError('Choisissez un ministere pour cette actualite', 400, 'MINISTRY_REQUIRED');
  }
}

function normalizeNewsPayload<T extends { content?: string | null; media?: unknown[] }>(dto: T) {
  const data: Record<string, unknown> = { ...dto };

  if ('content' in dto) {
    data['content'] = dto.content?.trim() ? dto.content.trim() : null;
  }

  if ('media' in dto) {
    data['media'] = (dto.media ?? []) as Prisma.InputJsonValue;
  }

  return data;
}

async function notifyPublishedNews(post: {
  id: string;
  title: string;
  content: string | null;
  regionId: string | null;
  districtId: string | null;
  assemblyId: string | null;
  ministryId: string | null;
}) {
  let assemblyId = post.assemblyId ?? undefined;

  if (!assemblyId && post.ministryId) {
    const ministry = await prisma.ministry.findUnique({
      where: { id: post.ministryId },
      select: { assemblyId: true },
    });
    assemblyId = ministry?.assemblyId;
  }

  void notifyUsers({
    title: `Nouvelle actualite : ${post.title}`,
    message: (post.content || 'Un nouveau moment fort vient d etre publie.').slice(0, 120),
    type: 'NEWS',
    entityType: 'NewsPost',
    entityId: post.id,
    scope: post.regionId || post.districtId || assemblyId
      ? {
          regionId: post.regionId ?? undefined,
          districtId: post.districtId ?? undefined,
          assemblyId,
        }
      : undefined,
  });
}

router.get('/', requirePermission(PERMISSIONS.NEWS_READ), async (req, res, next) => {
  try {
    const { search, level, status, type, assemblyId, districtId, regionId, featured } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);

    const where: Prisma.NewsPostWhereInput = {
      deletedAt: null,
      ...(level && { level: level as AnnouncementLevel }),
      ...(status && { status: status as NewsPostStatus }),
      ...(type && { type: type as NewsPostType }),
      ...(assemblyId && { assemblyId }),
      ...(districtId && { districtId }),
      ...(regionId && { regionId }),
      ...(featured && { featured: featured === 'true' }),
      AND: [
        visibilityWhere,
        ...(search
          ? [{
              OR: [
                { title: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { content: { contains: search, mode: Prisma.QueryMode.insensitive } },
              ],
            }]
          : []),
      ],
    };

    const [data, total] = await prisma.$transaction([
      prisma.newsPost.findMany({
        where,
        include: {
          users: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          regions: { select: { id: true, name: true } },
          districts: { select: { id: true, name: true } },
          assemblies: { select: { id: true, name: true } },
          ministries: { select: { id: true, name: true } },
          _count: { select: { comments: { where: { deletedAt: null } } } },
        },
        skip,
        take: limit,
        orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.newsPost.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.NEWS_READ), async (req, res, next) => {
  try {
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);
    const post = await prisma.newsPost.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...visibilityWhere },
      include: {
        users: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        regions: { select: { id: true, name: true } },
        districts: { select: { id: true, name: true } },
        assemblies: { select: { id: true, name: true } },
        ministries: { select: { id: true, name: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
    });

    if (!post) throw new NotFoundError('Actualite');
    sendSuccess(res, post);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.NEWS_WRITE), validate(createNewsPostSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createNewsPostSchema>;
    const status = dto.status ?? 'DRAFT';

    if (status === 'ARCHIVED') {
      throw new AppError('Une nouvelle actualite ne peut pas etre archivee directement', 400, 'INVALID_STATUS');
    }

    if (status === 'PUBLISHED' && !userHasPermission(req.user!, PERMISSIONS.NEWS_PUBLISH)) {
      throw new ForbiddenError('Vous ne pouvez pas publier une actualite');
    }

    assertEntityMatchesScope(dto);
    assertNewsTargetShape(dto);
    await assertAnnouncementTargetScope(req.user!, dto);

    const normalized = normalizeNewsPayload(dto);
    const post = await prisma.newsPost.create({
      data: {
        id: crypto.randomUUID(),
        updatedAt: new Date(),
        title: dto.title,
        content: normalized['content'] as string | null,
        media: (normalized['media'] ?? []) as Prisma.InputJsonValue,
        level: dto.level,
        regionId: dto.regionId ?? null,
        districtId: dto.districtId ?? null,
        assemblyId: dto.assemblyId ?? null,
        ministryId: dto.ministryId ?? null,
        type: dto.type ?? 'NEWS',
        status,
        allowComments: dto.allowComments ?? true,
        featured: dto.featured ?? false,
        tenantId: req.user!.tenantId,
        authorId: req.user!.id,
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
      },
      include: {
        users: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'NewsPost', entityId: post.id, req });

    if (post.status === 'PUBLISHED') {
      await notifyPublishedNews(post);
    }

    sendCreated(res, post, 'Actualite creee');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.NEWS_WRITE), validate(updateNewsPostSchema), async (req, res, next) => {
  try {
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);
    const existing = await prisma.newsPost.findFirst({
      where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] },
    });

    if (!existing) throw new NotFoundError('Actualite');
    if (existing.status === 'ARCHIVED') throw new AppError('Impossible de modifier une actualite archivee', 400, 'ARCHIVED');

    await assertAnnouncementTargetScope(req.user!, existing);

    const dto = req.body as z.infer<typeof updateNewsPostSchema>;
    const post = await prisma.newsPost.update({
      where: { id: existing.id },
      data: normalizeNewsPayload(dto) as Prisma.NewsPostUncheckedUpdateInput,
    });

    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'NewsPost', entityId: post.id, req });
    sendSuccess(res, post, 'Actualite mise a jour');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', requirePermission(PERMISSIONS.NEWS_PUBLISH), async (req, res, next) => {
  try {
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);
    const existing = await prisma.newsPost.findFirst({
      where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] },
    });

    if (!existing) throw new NotFoundError('Actualite');
    if (existing.status !== 'DRAFT') {
      throw new AppError('Seules les actualites en brouillon peuvent etre publiees', 400, 'INVALID_STATUS');
    }

    await assertAnnouncementTargetScope(req.user!, existing);

    const post = await prisma.newsPost.update({
      where: { id: existing.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'PUBLISH', entityType: 'NewsPost', entityId: post.id, req });
    await notifyPublishedNews(existing);
    sendSuccess(res, post, 'Actualite publiee');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', requirePermission(PERMISSIONS.NEWS_WRITE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);
    const existing = await prisma.newsPost.findFirst({
      where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] },
    });

    if (!existing) throw new NotFoundError('Actualite');
    await assertAnnouncementTargetScope(req.user!, existing);

    const post = await prisma.newsPost.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    await createAuditLog({ actorId: req.user!.id, action: 'ARCHIVE', entityType: 'NewsPost', entityId: post.id, req });
    sendSuccess(res, post, 'Actualite archivee');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.NEWS_DELETE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildNewsPostVisibilityFilter(req.user!);
    const existing = await prisma.newsPost.findFirst({
      where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] },
    });

    if (!existing) throw new NotFoundError('Actualite');
    await assertAnnouncementTargetScope(req.user!, existing);

    await prisma.newsPost.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Actualite supprimee');
  } catch (err) {
    next(err);
  }
});

export default router;
