import crypto from 'crypto';
import { Router } from 'express';
import { GroupStatus, GroupType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { NotFoundError } from '../../middlewares/error.middleware';
import { buildPaginationMeta, sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { assertAssemblyAccess, getScopedAssemblyWhere } from '../../utils/scope-access.util';
import { planLimitService } from '../../services/plan-limit.service';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createGroupSchema = z.object({
  name: z.string().min(2).max(100),
  assemblyId: z.string().uuid(),
  type: z.nativeEnum(GroupType).default(GroupType.OTHER),
  description: z.string().max(2000).optional().nullable(),
  leaderId: z.string().uuid().optional().nullable(),
  meetingDay: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']).optional().nullable(),
  meetingTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
});

const updateGroupSchema = createGroupSchema.partial().omit({ assemblyId: true });

const addMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['leader', 'assistant', 'member']).default('member'),
});

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

// GET / — liste des groupes
router.get('/', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const { assemblyId, type, status, search } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const scopedAssembly = await getScopedAssemblyWhere(req.user!);

    const where: Prisma.groupsWhereInput = {
      deletedAt: null,
      assemblies: scopedAssembly,
      ...(assemblyId && { assemblyId }),
      ...(type && { type: type as GroupType }),
      ...(status && { status: status as GroupStatus }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.groups.findMany({
        where,
        include: {
          assemblies: { select: { id: true, name: true } },
          users: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { group_members: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.groups.count({ where }),
    ]);

    sendPaginated(res, rows, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// GET /:id — détail
router.get('/:id', requirePermission(PERMISSIONS.MEMBERS_READ), async (req, res, next) => {
  try {
    const group = await prisma.groups.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        assemblies: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
        group_members: {
          where: { status: 'ACTIVE' },
          include: { members: { select: { id: true, firstName: true, lastName: true, gender: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundError('Groupe');
    await assertAssemblyAccess(req.user!, group.assemblyId);
    sendSuccess(res, group);
  } catch (err) { next(err); }
});

// POST / — créer un groupe
router.post('/', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(createGroupSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createGroupSchema>;
    await assertAssemblyAccess(req.user!, dto.assemblyId);

    // Vérification limite plan
    const tenantId = await planLimitService.resolveTenantIdFromAssembly(dto.assemblyId);
    const usage = await planLimitService.getTenantUsage(tenantId);
    await planLimitService.assertCanCreate(tenantId, 'maxGroups', usage.groups, 'groupes');

    const group = await prisma.groups.create({
      data: { id: crypto.randomUUID(), updatedAt: new Date(), ...dto },
      include: {
        assemblies: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Group', entityId: group.id, newValues: group as any, req });
    sendCreated(res, group, 'Groupe créé');
  } catch (err) { next(err); }
});

// PATCH /:id — modifier
router.patch('/:id', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(updateGroupSchema), async (req, res, next) => {
  try {
    const existing = await prisma.groups.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Groupe');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    const group = await prisma.groups.update({
      where: { id: req.params['id'] },
      data: { updatedAt: new Date(), ...(req.body as z.infer<typeof updateGroupSchema>) },
      include: {
        assemblies: { select: { id: true, name: true } },
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    sendSuccess(res, group, 'Groupe mis à jour');
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', requirePermission(PERMISSIONS.MEMBERS_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.groups.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Groupe');
    await assertAssemblyAccess(req.user!, existing.assemblyId);
    await prisma.groups.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date(), status: GroupStatus.DISSOLVED } });
    sendSuccess(res, null, 'Groupe supprimé');
  } catch (err) { next(err); }
});

// POST /:id/members — ajouter un membre
router.post('/:id/members', requirePermission(PERMISSIONS.MEMBERS_WRITE), validate(addMemberSchema), async (req, res, next) => {
  try {
    const group = await prisma.groups.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!group) throw new NotFoundError('Groupe');
    await assertAssemblyAccess(req.user!, group.assemblyId);

    const { memberId, role } = req.body as z.infer<typeof addMemberSchema>;

    const member = await prisma.member.findFirst({ where: { id: memberId, assemblyId: group.assemblyId, deletedAt: null } });
    if (!member) throw new NotFoundError('Membre');

    const gm = await prisma.group_members.upsert({
      where: { groupId_memberId: { groupId: group.id, memberId } },
      update: { status: 'ACTIVE', role, leftAt: null, updatedAt: new Date() },
      create: { id: crypto.randomUUID(), updatedAt: new Date(), groupId: group.id, memberId, role },
      include: { members: { select: { id: true, firstName: true, lastName: true } } },
    });
    sendCreated(res, gm, 'Membre ajouté au groupe');
  } catch (err) { next(err); }
});

// DELETE /:id/members/:memberId — retirer un membre
router.delete('/:id/members/:memberId', requirePermission(PERMISSIONS.MEMBERS_WRITE), async (req, res, next) => {
  try {
    const group = await prisma.groups.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!group) throw new NotFoundError('Groupe');
    await assertAssemblyAccess(req.user!, group.assemblyId);

    const existing = await prisma.group_members.findFirst({
      where: { groupId: group.id, memberId: req.params['memberId'] },
    });
    if (!existing) throw new NotFoundError('Membre dans ce groupe');

    await prisma.group_members.update({
      where: { id: existing.id },
      data: { status: 'INACTIVE', leftAt: new Date() },
    });
    sendSuccess(res, null, 'Membre retiré du groupe');
  } catch (err) { next(err); }
});

export default router;
