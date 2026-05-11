import { Router } from 'express';
import { Prisma, EventStatus, AttendeeStatus } from '@prisma/client';
import { z } from 'zod';
import { flexDate, flexDateOptional, latitudeField, longitudeField } from '../../utils/zod.util';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { NotFoundError, AppError } from '../../middlewares/error.middleware';
import { createCommentsRouter } from '../comments/comments.routes';
import {
  assertEntityMatchesScope,
  assertEventTargetScope,
  buildEventVisibilityFilter,
} from '../../utils/scope-access.util';

const rsvpSchema = z.object({
  status: z.nativeEnum(AttendeeStatus),
});

const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  startDate: flexDate,
  endDate: flexDateOptional,
  location: z.string().optional(),
  latitude: latitudeField,
  longitude: longitudeField,
  level: z.enum(['NATIONAL', 'REGIONAL', 'DISTRICT', 'ASSEMBLY']),
  regionId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable(),
  maxAttendees: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().int().positive().optional().nullable()),
  isPublic: z.boolean().default(true),
});

const updateEventSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  startDate: flexDate.optional(),
  endDate: flexDateOptional,
  location: z.string().optional(),
  latitude: latitudeField,
  longitude: longitudeField,
  maxAttendees: z.preprocess((v) => (v === '' || v === null ? null : Number(v)), z.number().int().positive().optional().nullable()),
  isPublic: z.boolean().optional(),
}).strict();

const router = Router();
router.use(authenticate);
router.use('/:id/comments', requirePermission(PERMISSIONS.EVENTS_READ), createCommentsRouter('event'));

router.get('/', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const { search, level, status, assemblyId, districtId, regionId, from, to } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const visibilityWhere = await buildEventVisibilityFilter(req.user!);

    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(level && { level }),
      ...(status && { status: status as EventStatus }),
      ...(assemblyId && { assemblyId }),
      ...(districtId && { districtId }),
      ...(regionId && { regionId }),
      ...(from && { startDate: { gte: new Date(from) } }),
      ...(to && { startDate: { lte: new Date(to) } }),
      AND: [
        visibilityWhere,
        ...(search ? [{ title: { contains: search, mode: Prisma.QueryMode.insensitive } }] : []),
      ],
    };

    const [data, total] = await prisma.$transaction([
      prisma.event.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          region: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
          assembly: { select: { id: true, name: true } },
        },
        skip,
        take: limit,
        orderBy: { startDate: 'asc' },
      }),
      prisma.event.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const visibilityWhere = await buildEventVisibilityFilter(req.user!);
    const event = await prisma.event.findFirst({
      where: { id: req.params['id'], deletedAt: null, ...visibilityWhere },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
        region: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        assembly: { select: { id: true, name: true } },
      },
    });
    if (!event) throw new NotFoundError('Evenement');
    sendSuccess(res, event);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(createEventSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createEventSchema>;
    assertEntityMatchesScope(dto);
    await assertEventTargetScope(req.user!, dto);

    const event = await prisma.event.create({
      data: {
        ...dto,
        tenantId: req.user!.tenantId,
        authorId: req.user!.id,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'CREATE', entityType: 'Event', entityId: event.id, req });
    sendCreated(res, event, 'Evenement cree');
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.EVENTS_WRITE), validate(updateEventSchema), async (req, res, next) => {
  try {
    const visibilityWhere = await buildEventVisibilityFilter(req.user!);
    const existing = await prisma.event.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Evenement');
    await assertEventTargetScope(req.user!, existing);

    const dto = req.body as z.infer<typeof updateEventSchema>;
    const event = await prisma.event.update({
      where: { id: req.params['id'] },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
      },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'UPDATE', entityType: 'Event', entityId: event.id, req });
    sendSuccess(res, event, 'Evenement mis a jour');
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', requirePermission(PERMISSIONS.EVENTS_PUBLISH), async (req, res, next) => {
  try {
    const visibilityWhere = await buildEventVisibilityFilter(req.user!);
    const existing = await prisma.event.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Evenement');
    if (existing.status !== 'DRAFT') throw new AppError('Seuls les evenements en brouillon peuvent etre publies', 400, 'INVALID_STATUS');
    await assertEventTargetScope(req.user!, existing);

    const event = await prisma.event.update({
      where: { id: req.params['id'] },
      data: { status: 'PUBLISHED' },
    });
    await createAuditLog({ actorId: req.user!.id, action: 'PUBLISH', entityType: 'Event', entityId: event.id, req });
    sendSuccess(res, event, 'Evenement publie');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.EVENTS_DELETE), async (req, res, next) => {
  try {
    const visibilityWhere = await buildEventVisibilityFilter(req.user!);
    const existing = await prisma.event.findFirst({ where: { id: req.params['id'], deletedAt: null, AND: [visibilityWhere] } });
    if (!existing) throw new NotFoundError('Evenement');
    await assertEventTargetScope(req.user!, existing);
    await prisma.event.update({ where: { id: req.params['id'] }, data: { deletedAt: new Date(), status: 'CANCELLED' } });
    sendSuccess(res, null, 'Evenement supprime');
  } catch (err) {
    next(err);
  }
});

// ─── RSVP ────────────────────────────────────

router.get('/:id/attendees', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!event) throw new NotFoundError('Evenement');
    const { page, limit, skip } = req.pagination!;
    const [data, total] = await prisma.$transaction([
      prisma.eventAttendee.findMany({
        where: { eventId: req.params['id'] },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
          member: { select: { id: true, firstName: true, lastName: true, matricule: true } },
        },
        orderBy: { registeredAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.eventAttendee.count({ where: { eventId: req.params['id'] } }),
    ]);
    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/rsvp', requirePermission(PERMISSIONS.EVENTS_READ), validate(rsvpSchema), async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params['id'], deletedAt: null } });
    if (!event) throw new NotFoundError('Evenement');
    if (event.status !== 'PUBLISHED') throw new AppError('Seuls les evenements publies acceptent les inscriptions', 400, 'INVALID_STATUS');

    const { status } = req.body as z.infer<typeof rsvpSchema>;
    const userId = req.user!.id;

    if (status === 'GOING' && event.maxAttendees) {
      const goingCount = await prisma.eventAttendee.count({ where: { eventId: req.params['id'], status: 'GOING' } });
      const existing = await prisma.eventAttendee.findUnique({ where: { eventId_userId: { eventId: req.params['id'], userId } } });
      if (!existing && goingCount >= event.maxAttendees) {
        throw new AppError('Nombre maximum de participants atteint', 400, 'MAX_ATTENDEES_REACHED');
      }
    }

    const linkedMember = await prisma.member.findFirst({ where: { user: { id: userId }, deletedAt: null }, select: { id: true } });
    const attendee = await prisma.eventAttendee.upsert({
      where: { eventId_userId: { eventId: req.params['id'], userId } },
      create: { eventId: req.params['id'], userId, memberId: linkedMember?.id ?? null, status },
      update: { status },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    sendSuccess(res, attendee, 'RSVP enregistre');
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/rsvp', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: req.params['id'], userId: req.user!.id } },
    });
    if (!attendee) throw new NotFoundError('Inscription');
    await prisma.eventAttendee.delete({ where: { id: attendee.id } });
    sendSuccess(res, null, 'Inscription annulee');
  } catch (err) {
    next(err);
  }
});

router.get('/:id/rsvp/me', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: req.params['id'], userId: req.user!.id } },
    });
    sendSuccess(res, attendee ?? null);
  } catch (err) {
    next(err);
  }
});

export default router;
