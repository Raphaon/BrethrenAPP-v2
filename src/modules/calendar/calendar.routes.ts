import { EventStatus, PersonalEventStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { AppError, NotFoundError } from '../../middlewares/error.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { createAuditLog } from '../../utils/audit.util';
import { sendCreated, sendSuccess } from '../../utils/response.util';
import { buildEventVisibilityFilter } from '../../utils/scope-access.util';

const router = Router();

const personalEventSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  location: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(20).optional(),
  isAllDay: z.boolean().default(false),
});

const personalEventUpdateSchema = personalEventSchema
  .partial()
  .extend({
    status: z.nativeEnum(PersonalEventStatus).optional(),
  })
  .strict();

router.use(authenticate);

router.get('/feed', requirePermission(PERMISSIONS.EVENTS_READ), async (req, res, next) => {
  try {
    const { from, to, status } = req.query as Record<string, string | undefined>;

    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = to ? new Date(to) : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new AppError('Dates invalides', 400, 'INVALID_DATE');
    }

    if (endDate < startDate) {
      throw new AppError('La date de fin doit etre apres la date de debut', 400, 'INVALID_DATE_RANGE');
    }

    const visibilityFilter = await buildEventVisibilityFilter(req.user!);
    const eventStatus: EventStatus | undefined = status ? (status as EventStatus) : EventStatus.PUBLISHED;

    const [events, personalEvents] = await prisma.$transaction([
      prisma.event.findMany({
        where: {
          deletedAt: null,
          AND: [
            visibilityFilter,
            {
              OR: [
                { startDate: { gte: startDate, lte: endDate } },
                {
                  AND: [
                    { endDate: { not: null } },
                    { startDate: { lte: endDate } },
                    { endDate: { gte: startDate } },
                  ],
                },
              ],
            },
          ],
          ...(eventStatus && { status: eventStatus }),
        },
        include: {
          region: { select: { id: true, name: true } },
          district: { select: { id: true, name: true } },
          assembly: { select: { id: true, name: true } },
        },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.personalEvent.findMany({
        where: {
          userId: req.user!.id,
          deletedAt: null,
          OR: [
            { startDate: { gte: startDate, lte: endDate } },
            {
              AND: [
                { endDate: { not: null } },
                { startDate: { lte: endDate } },
                { endDate: { gte: startDate } },
              ],
            },
          ],
        },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    const feed = [
      ...events.map((event) => ({
        id: event.id,
        source: 'global',
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
        latitude: event.latitude,
        longitude: event.longitude,
        level: event.level,
        status: event.status,
        region: event.region,
        district: event.district,
        assembly: event.assembly,
      })),
      ...personalEvents.map((event) => ({
        id: event.id,
        source: 'personal',
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
        notes: event.notes,
        color: event.color,
        isAllDay: event.isAllDay,
        status: event.status,
      })),
    ].sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());

    sendSuccess(res, feed);
  } catch (err) {
    next(err);
  }
});

router.get('/personal-events', async (req, res, next) => {
  try {
    const { from, to, status } = req.query as Record<string, string | undefined>;

    const where = {
      userId: req.user!.id,
      deletedAt: null,
      ...(status && { status: status as PersonalEventStatus }),
      ...(from || to
        ? {
            OR: [
              {
                startDate: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              },
              ...(from && to
                ? [
                    {
                      AND: [
                        { endDate: { not: null } },
                        { startDate: { lte: new Date(to) } },
                        { endDate: { gte: new Date(from) } },
                      ],
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const events = await prisma.personalEvent.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    sendSuccess(res, events);
  } catch (err) {
    next(err);
  }
});

router.post('/personal-events', validate(personalEventSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof personalEventSchema>;

    const event = await prisma.personalEvent.create({
      data: {
        userId: req.user!.id,
        title: dto.title,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        location: dto.location,
        notes: dto.notes,
        color: dto.color,
        isAllDay: dto.isAllDay,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'CREATE',
      entityType: 'PersonalEvent',
      entityId: event.id,
      req,
    });

    sendCreated(res, event, 'Evenement personnel cree');
  } catch (err) {
    next(err);
  }
});

router.patch('/personal-events/:id', validate(personalEventUpdateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.personalEvent.findFirst({
      where: {
        id: req.params['id'],
        userId: req.user!.id,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundError('Evenement personnel');
    }

    const dto = req.body as z.infer<typeof personalEventUpdateSchema>;

    const event = await prisma.personalEvent.update({
      where: { id: existing.id },
      data: {
        title: dto.title,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        location: dto.location,
        notes: dto.notes,
        color: dto.color,
        isAllDay: dto.isAllDay,
        status: dto.status,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'UPDATE',
      entityType: 'PersonalEvent',
      entityId: event.id,
      req,
    });

    sendSuccess(res, event, 'Evenement personnel mis a jour');
  } catch (err) {
    next(err);
  }
});

router.delete('/personal-events/:id', async (req, res, next) => {
  try {
    const existing = await prisma.personalEvent.findFirst({
      where: {
        id: req.params['id'],
        userId: req.user!.id,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundError('Evenement personnel');
    }

    await prisma.personalEvent.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        status: PersonalEventStatus.CANCELLED,
      },
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'DELETE',
      entityType: 'PersonalEvent',
      entityId: existing.id,
      req,
    });

    sendSuccess(res, null, 'Evenement personnel supprime');
  } catch (err) {
    next(err);
  }
});

export default router;
