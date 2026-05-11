import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { flexDateOptional } from '../../utils/zod.util';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { getScopedPastorWhere, assertAssemblyAccess } from '../../utils/scope-access.util';

const createPastorSchema = z.object({
  memberId: z.string().uuid(),
  title: z.string().optional(),
  ordainedAt: flexDateOptional,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  assemblyId: z.string().uuid().optional().nullable(),
});

const updatePastorSchema = createPastorSchema.partial().omit({ memberId: true }).strict();

const spouseSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  birthDate: flexDateOptional,
  profession: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const childSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']),
  birthDate: flexDateOptional,
});

const diplomaSchema = z.object({
  type: z.enum(['BACCALAUREAT', 'LICENCE', 'MASTER', 'DOCTORAT', 'DIPLOME_THEOLOGIE', 'CERTIFICAT_THEOLOGIE', 'AUTRE']),
  title: z.string().min(1),
  institution: z.string().optional().nullable(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const PASTOR_FULL_INCLUDE = {
  member: {
    select: {
      id: true, firstName: true, lastName: true, matricule: true,
      phone: true, email: true, gender: true, birthDate: true,
      photo: true, address: true, profession: true, maritalStatus: true,
    },
  },
  assembly: {
    select: {
      id: true, name: true,
      district: { select: { id: true, name: true, region: { select: { id: true, name: true, code: true } } } },
    },
  },
  assignments: {
    orderBy: { startDate: 'desc' as const },
    include: {
      assembly: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
    },
  },
  spouse: true,
  children: { orderBy: { birthDate: 'asc' as const } },
  diplomas: { orderBy: { year: 'desc' as const } },
};

const router = Router();
router.use(authenticate);

// ── LIST with advanced filters ────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.PASTORS_READ), async (req, res, next) => {
  try {
    const {
      search, assemblyId, districtId, regionId, status,
      minYearsService, maxYearsService, ordainedBefore, ordainedAfter,
    } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const now = new Date();

    // Convert yearsService bounds to ordainedAt date bounds (SQL-level filtering)
    const ordainedAtFilter: Prisma.DateTimeNullableFilter = {};
    if (ordainedAfter) ordainedAtFilter.gte = new Date(ordainedAfter);
    if (ordainedBefore) ordainedAtFilter.lte = new Date(ordainedBefore);
    // minYearsService N → ordained at least N years ago → ordainedAt <= now - N years
    if (minYearsService) {
      const bound = new Date(now);
      bound.setFullYear(bound.getFullYear() - Number(minYearsService));
      ordainedAtFilter.lte = ordainedAtFilter.lte && ordainedAtFilter.lte < bound ? ordainedAtFilter.lte : bound;
    }
    // maxYearsService M → ordained at most M years ago → ordainedAt >= now - M years
    if (maxYearsService) {
      const bound = new Date(now);
      bound.setFullYear(bound.getFullYear() - Number(maxYearsService));
      ordainedAtFilter.gte = ordainedAtFilter.gte && ordainedAtFilter.gte > bound ? ordainedAtFilter.gte : bound;
    }

    const pastorScope = await getScopedPastorWhere(req.user!);

    const where: Prisma.PastorWhereInput = {
      ...pastorScope,
      deletedAt: null,
      ...(status && { status }),
      ...(assemblyId && { assemblyId }),
      ...(Object.keys(ordainedAtFilter).length && { ordainedAt: ordainedAtFilter }),
      ...(districtId && { assembly: { districtId } }),
      ...(regionId && { assembly: { district: { regionId } } }),
      ...(search && {
        member: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { matricule: { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.pastor.findMany({
        where,
        include: {
          member: { select: { id: true, firstName: true, lastName: true, matricule: true, phone: true, birthDate: true } },
          assembly: {
            select: {
              id: true, name: true,
              district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
            },
          },
          assignments: { where: { status: 'ACTIVE' }, include: { assembly: { select: { id: true, name: true } } } },
          _count: { select: { children: true } },
        },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      prisma.pastor.count({ where }),
    ]);

    // enrich with computed fields
    const enriched = data.map((p) => {
      const birthDate = (p.member as any).birthDate;
      const yearsService = p.ordainedAt ? Math.floor((now.getTime() - new Date(p.ordainedAt).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
      const yearsRemaining = birthDate ? Math.max(0, 65 - Math.floor((now.getTime() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))) : null;
      const retirementDate = birthDate ? new Date(new Date(birthDate).setFullYear(new Date(birthDate).getFullYear() + 65)) : null;
      return { ...p, yearsService, yearsRemaining, retirementDate };
    });

    sendPaginated(res, enriched, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// ── FULL PROFILE (for printing) ───────────────────────────────────────────────
router.get('/:id/full', requirePermission(PERMISSIONS.PASTORS_READ), async (req, res, next) => {
  try {
    const pastor = await prisma.pastor.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: PASTOR_FULL_INCLUDE,
    });
    if (!pastor) throw new NotFoundError('Pasteur');
    if (pastor.assemblyId) await assertAssemblyAccess(req.user!, pastor.assemblyId);

    const now = new Date();
    const birthDate = (pastor.member as any).birthDate;
    const yearsService = pastor.ordainedAt ? Math.floor((now.getTime() - new Date(pastor.ordainedAt).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
    const yearsRemaining = birthDate ? Math.max(0, 65 - Math.floor((now.getTime() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))) : null;
    const retirementDate = birthDate ? new Date(new Date(birthDate).setFullYear(new Date(birthDate).getFullYear() + 65)) : null;

    sendSuccess(res, { ...pastor, yearsService, yearsRemaining, retirementDate });
  } catch (err) { next(err); }
});

// ── REPORT : list by region ───────────────────────────────────────────────────
router.get('/report/by-region', requirePermission(PERMISSIONS.PASTORS_READ), async (_req, res, next) => {
  try {
    const regions = await prisma.region.findMany({
      where: { deletedAt: null },
      include: {
        districts: {
          where: { deletedAt: null },
          include: {
            assemblies: {
              where: { deletedAt: null },
              include: {
                pastors: {
                  where: { deletedAt: null },
                  include: {
                    member: { select: { firstName: true, lastName: true, matricule: true, birthDate: true, phone: true } },
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const now = new Date();
    const report = regions.map((region) => {
      let totalPastors = 0;
      const districts = region.districts.map((district) => {
        const assemblies = district.assemblies.map((assembly) => {
          const pastors = assembly.pastors.map((p) => {
            const birthDate = (p.member as any).birthDate;
            const yearsService = p.ordainedAt ? Math.floor((now.getTime() - new Date(p.ordainedAt).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
            const yearsRemaining = birthDate ? Math.max(0, 65 - Math.floor((now.getTime() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))) : null;
            const retirementDate = birthDate ? new Date(new Date(birthDate).setFullYear(new Date(birthDate).getFullYear() + 65)) : null;
            return { ...p, yearsService, yearsRemaining, retirementDate };
          });
          totalPastors += pastors.length;
          return { ...assembly, pastors };
        });
        return { ...district, assemblies };
      });
      return { ...region, districts, totalPastors };
    });

    sendSuccess(res, report);
  } catch (err) { next(err); }
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get('/:id', requirePermission(PERMISSIONS.PASTORS_READ), async (req, res, next) => {
  try {
    const pastor = await prisma.pastor.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: PASTOR_FULL_INCLUDE,
    });
    if (!pastor) throw new NotFoundError('Pasteur');

    const now = new Date();
    const birthDate = (pastor.member as any).birthDate;
    const yearsService = pastor.ordainedAt ? Math.floor((now.getTime() - new Date(pastor.ordainedAt).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
    const yearsRemaining = birthDate ? Math.max(0, 65 - Math.floor((now.getTime() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))) : null;
    const retirementDate = birthDate ? new Date(new Date(birthDate).setFullYear(new Date(birthDate).getFullYear() + 65)) : null;

    sendSuccess(res, { ...pastor, yearsService, yearsRemaining, retirementDate });
  } catch (err) { next(err); }
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', requirePermission(PERMISSIONS.PASTORS_WRITE), validate(createPastorSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createPastorSchema>;
    const member = await prisma.member.findUnique({ where: { id: dto.memberId, deletedAt: null } });
    if (!member) throw new NotFoundError('Membre');
    const existing = await prisma.pastor.findUnique({ where: { memberId: dto.memberId } });
    if (existing && !existing.deletedAt) throw new AppError('Ce membre est déjà enregistré comme pasteur', 409, 'DUPLICATE');

    const pastor = await prisma.pastor.create({
      data: { ...dto, ordainedAt: dto.ordainedAt ? new Date(dto.ordainedAt) : null },
      include: { member: { select: { id: true, firstName: true, lastName: true, matricule: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Pastor', entityId: pastor.id, req });
    sendCreated(res, pastor, 'Pasteur enregistré');
  } catch (err) { next(err); }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch('/:id', requirePermission(PERMISSIONS.PASTORS_WRITE), validate(updatePastorSchema), async (req, res, next) => {
  try {
    const existing = await prisma.pastor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Pasteur');
    const dto = req.body as z.infer<typeof updatePastorSchema>;
    const pastor = await prisma.pastor.update({
      where: { id: req.params['id'] },
      data: { ...dto, ordainedAt: dto.ordainedAt ? new Date(dto.ordainedAt) : undefined },
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Pastor', entityId: pastor.id, req });
    sendSuccess(res, pastor, 'Pasteur mis à jour');
  } catch (err) { next(err); }
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete('/:id', requirePermission(PERMISSIONS.PASTORS_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.pastor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Pasteur');
    await prisma.pastor.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    await createAuditLog({ actorId: req.user!.id, action: 'DELETE', entityType: 'Pastor', entityId: req.params['id'], req });
    sendSuccess(res, null, 'Pasteur supprimé');
  } catch (err) { next(err); }
});

// ── SPOUSE ────────────────────────────────────────────────────────────────────
router.put('/:id/spouse', requirePermission(PERMISSIONS.PASTORS_WRITE), validate(spouseSchema), async (req, res, next) => {
  try {
    const pastor = await prisma.pastor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!pastor) throw new NotFoundError('Pasteur');
    const dto = req.body as z.infer<typeof spouseSchema>;
    const spouse = await prisma.pastorSpouse.upsert({
      where: { pastorId: req.params['id'] },
      create: { pastorId: req.params['id'], ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : null },
      update: { ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : null },
    });
    sendSuccess(res, spouse, 'Épouse mise à jour');
  } catch (err) { next(err); }
});

router.delete('/:id/spouse', requirePermission(PERMISSIONS.PASTORS_WRITE), async (req, res, next) => {
  try {
    await prisma.pastorSpouse.deleteMany({ where: { pastorId: req.params['id'] } });
    sendSuccess(res, null, 'Épouse supprimée');
  } catch (err) { next(err); }
});

// ── CHILDREN ──────────────────────────────────────────────────────────────────
router.post('/:id/children', requirePermission(PERMISSIONS.PASTORS_WRITE), validate(childSchema), async (req, res, next) => {
  try {
    const pastor = await prisma.pastor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!pastor) throw new NotFoundError('Pasteur');
    const dto = req.body as z.infer<typeof childSchema>;
    const child = await prisma.pastorChild.create({
      data: { pastorId: req.params['id'], ...dto, birthDate: dto.birthDate ? new Date(dto.birthDate) : null },
    });
    sendCreated(res, child, 'Enfant ajouté');
  } catch (err) { next(err); }
});

router.delete('/:id/children/:childId', requirePermission(PERMISSIONS.PASTORS_WRITE), async (req, res, next) => {
  try {
    await prisma.pastorChild.delete({ where: { id: req.params['childId'] } });
    sendSuccess(res, null, 'Enfant supprimé');
  } catch (err) { next(err); }
});

// ── DIPLOMAS ──────────────────────────────────────────────────────────────────
router.post('/:id/diplomas', requirePermission(PERMISSIONS.PASTORS_WRITE), validate(diplomaSchema), async (req, res, next) => {
  try {
    const pastor = await prisma.pastor.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!pastor) throw new NotFoundError('Pasteur');
    const dto = req.body as z.infer<typeof diplomaSchema>;
    const diploma = await prisma.pastorDiploma.create({ data: { pastorId: req.params['id'], ...dto } });
    sendCreated(res, diploma, 'Diplôme ajouté');
  } catch (err) { next(err); }
});

router.delete('/:id/diplomas/:diplomaId', requirePermission(PERMISSIONS.PASTORS_WRITE), async (req, res, next) => {
  try {
    await prisma.pastorDiploma.delete({ where: { id: req.params['diplomaId'] } });
    sendSuccess(res, null, 'Diplôme supprimé');
  } catch (err) { next(err); }
});

export default router;
