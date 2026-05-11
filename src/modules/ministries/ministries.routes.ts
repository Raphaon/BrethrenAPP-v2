import { Router } from 'express';
import { Prisma, GroupJoinMode } from '@prisma/client';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { getScopedAssemblyWhere, assertAssemblyAccess } from '../../utils/scope-access.util';

const createMinistrySchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  assemblyId: z.string().uuid(),
  leaderId: z.string().uuid().optional().nullable(),
  type: z.enum(['choir', 'youth', 'women', 'men', 'children', 'prayer', 'evangelism', 'other']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

const updateMinistrySchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  leaderId: z.string().uuid().optional().nullable(),
  type: z.enum(['choir', 'youth', 'women', 'men', 'children', 'prayer', 'evangelism', 'other']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict();

const addMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['leader', 'assistant', 'member']).default('member'),
});

const settingsSchema = z.object({
  chatEnabled: z.boolean().optional(),
  memberListVisible: z.boolean().optional(),
  joinMode: z.nativeEnum(GroupJoinMode).optional(),
  isPrivate: z.boolean().optional(),
}).strict();

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.MINISTRIES_READ), async (req, res, next) => {
  try {
    const { search, assemblyId, type, status } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;

    const assemblyScope = await getScopedAssemblyWhere(req.user!);

    const where: Prisma.MinistryWhereInput = {
      deletedAt: null,
      assembly: assemblyScope,
      ...(assemblyId && { assemblyId }),
      ...(type && { type }),
      ...(status && { status }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.ministry.findMany({
        where,
        include: {
          assembly: { select: { id: true, name: true } },
          _count: { select: { members: true } },
        },
        skip, take: limit, orderBy: { name: 'asc' },
      }),
      prisma.ministry.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id/members', requirePermission(PERMISSIONS.MINISTRIES_READ), async (req, res, next) => {
  try {
    const ministry = await prisma.ministry.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!ministry) throw new NotFoundError('Ministère');
    await assertAssemblyAccess(req.user!, ministry.assemblyId);

    const { page, limit, skip } = req.pagination!;
    const where: Prisma.MinistryMemberWhereInput = {
      ministryId: req.params['id'],
      status: 'ACTIVE',
      member: { deletedAt: null },
    };

    const [data, total] = await prisma.$transaction([
      prisma.ministryMember.findMany({
        where,
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              matricule: true,
              phone: true,
              user: { select: { email: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      }),
      prisma.ministryMember.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission(PERMISSIONS.MINISTRIES_READ), async (req, res, next) => {
  try {
    const ministry = await prisma.ministry.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        assembly: { select: { id: true, name: true } },
        conversation: { select: { id: true, title: true } },
        members: {
          where: { status: 'ACTIVE' },
          include: { member: { select: { id: true, firstName: true, lastName: true, matricule: true, phone: true } } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        },
        _count: { select: { members: true } },
      },
    });
    if (!ministry) throw new NotFoundError('Ministère');
    await assertAssemblyAccess(req.user!, ministry.assemblyId);
    sendSuccess(res, ministry);
  } catch (err) { next(err); }
});

router.post('/', requirePermission(PERMISSIONS.MINISTRIES_WRITE), validate(createMinistrySchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createMinistrySchema>;
    const assembly = await prisma.assembly.findUnique({ where: { id: dto.assemblyId, deletedAt: null } });
    if (!assembly) throw new NotFoundError('Assemblée');
    await assertAssemblyAccess(req.user!, dto.assemblyId);

    const existing = await prisma.ministry.findFirst({ where: { name: dto.name, assemblyId: dto.assemblyId, deletedAt: null } });
    if (existing) throw new AppError(`Un ministère "${dto.name}" existe déjà dans cette assemblée`, 409, 'DUPLICATE');

    const ministry = await prisma.ministry.create({
      data: dto,
      include: { assembly: { select: { id: true, name: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Ministry', entityId: ministry.id, req });
    sendCreated(res, ministry, 'Ministère créé');
  } catch (err) { next(err); }
});

router.patch('/:id', requirePermission(PERMISSIONS.MINISTRIES_WRITE), validate(updateMinistrySchema), async (req, res, next) => {
  try {
    const existing = await prisma.ministry.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Ministère');
    const ministry = await prisma.ministry.update({
      where: { id: req.params['id'] },
      data: req.body as z.infer<typeof updateMinistrySchema>,
    });
    sendSuccess(res, ministry, 'Ministère mis à jour');
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission(PERMISSIONS.MINISTRIES_DELETE), async (req, res, next) => {
  try {
    const existing = await prisma.ministry.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!existing) throw new NotFoundError('Ministère');
    await prisma.ministry.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date() } });
    sendSuccess(res, null, 'Ministère supprimé');
  } catch (err) { next(err); }
});

// Paramètres du groupe
router.patch('/:id/settings', requirePermission(PERMISSIONS.MINISTRIES_WRITE), validate(settingsSchema), async (req, res, next) => {
  try {
    const existing = await prisma.ministry.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: { members: { where: { status: 'ACTIVE' }, include: { member: { include: { user: { select: { id: true } } } } } } },
    });
    if (!existing) throw new NotFoundError('Ministère');

    const dto = req.body as z.infer<typeof settingsSchema>;
    let conversationId = existing.conversationId;

    // Auto-create group conversation when chat is enabled
    if (dto.chatEnabled === true && !conversationId) {
      const conv = await prisma.conversation.create({ data: { title: existing.name, isGroup: true } });
      conversationId = conv.id;

      // Add all active members who have a linked user account
      const userIds = existing.members
        .map((mm) => mm.member?.user?.id)
        .filter((id): id is string => Boolean(id));
      if (userIds.length > 0) {
        await prisma.conversationParticipant.createMany({
          data: userIds.map((uid) => ({ conversationId: conv.id, userId: uid, role: 'member' })),
          skipDuplicates: true,
        });
      }
    }

    const ministry = await prisma.ministry.update({
      where: { id: req.params['id'] },
      data: { ...dto, conversationId },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Ministry', entityId: ministry.id, newValues: dto, req });
    sendSuccess(res, ministry, 'Paramètres mis à jour');
  } catch (err) { next(err); }
});

// Membres du ministère
router.post('/:id/members', requirePermission(PERMISSIONS.MINISTRIES_WRITE), validate(addMemberSchema), async (req, res, next) => {
  try {
    const { memberId, role } = req.body as z.infer<typeof addMemberSchema>;
    const ministry = await prisma.ministry.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!ministry) throw new NotFoundError('Ministère');

    const member = await prisma.member.findUnique({ where: { id: memberId, assemblyId: ministry.assemblyId, deletedAt: null } });
    if (!member) throw new NotFoundError('Membre dans cette assemblée');

    const existing = await prisma.ministryMember.findFirst({ where: { ministryId: req.params['id'], memberId, status: 'ACTIVE' } });
    if (existing) throw new AppError('Ce membre est déjà dans ce ministère', 409, 'ALREADY_MEMBER');

    const mm = await prisma.ministryMember.upsert({
      where: { ministryId_memberId: { ministryId: req.params['id'], memberId } },
      update: { role, status: 'ACTIVE', leftAt: null },
      create: { ministryId: req.params['id'], memberId, role },
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    });

    sendCreated(res, mm, 'Membre ajouté au ministère');
  } catch (err) { next(err); }
});

router.delete('/:id/members/:memberId', requirePermission(PERMISSIONS.MINISTRIES_WRITE), async (req, res, next) => {
  try {
    const mm = await prisma.ministryMember.delete({
      where: {
        ministryId_memberId: { ministryId: req.params['id'], memberId: req.params['memberId'] },
      },
    });
    sendSuccess(res, mm, 'Membre retire du ministere');
  } catch (err) { next(err); }
});

export default router;
