import { Router } from 'express';
import { NotificationStatus } from '@prisma/client';
import { authenticate } from '../../middlewares/auth.middleware';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { NotFoundError } from '../../middlewares/error.middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query as Record<string, string>;
    const { page, limit, skip } = req.pagination!;
    const userId = req.user!.id;

    const where = {
      userId,
      ...(status && { status: status as NotificationStatus }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, status: 'UNREAD' } });
    sendSuccess(res, { count });
  } catch (err) { next(err); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({ where: { id: req.params['id'], userId: req.user!.id } });
    if (!notif) throw new NotFoundError('Notification');

    await prisma.notification.update({
      where: { id: req.params['id'] },
      data: { status: 'READ', readAt: new Date() },
    });
    sendSuccess(res, null, 'Notification marquée comme lue');
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    sendSuccess(res, null, 'Toutes les notifications marquées comme lues');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({ where: { id: req.params['id'], userId: req.user!.id } });
    if (!notif) throw new NotFoundError('Notification');
    await prisma.notification.delete({ where: { id: req.params['id'] } });
    sendSuccess(res, null, 'Notification supprimée');
  } catch (err) { next(err); }
});

router.delete('/', async (req, res, next) => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.user!.id, status: 'READ' } });
    sendSuccess(res, null, 'Notifications lues supprimées');
  } catch (err) { next(err); }
});

export default router;
