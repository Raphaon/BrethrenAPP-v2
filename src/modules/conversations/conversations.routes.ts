import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { prisma } from '../../database/prisma';
import { sendSuccess, sendCreated, sendPaginated, buildPaginationMeta } from '../../utils/response.util';
import { AppError, NotFoundError } from '../../middlewares/error.middleware';

const createConversationSchema = z.object({
  title: z.string().optional(),
  isGroup: z.boolean().default(false),
  participantIds: z.array(z.string().uuid()).min(1).max(50),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message requis').max(4000),
  type: z.enum(['text', 'image', 'file']).default('text'),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(120),
}).strict();

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const userId = req.user!.id;

    const [data, total] = await prisma.$transaction([
      prisma.conversation.findMany({
        where: {
          deletedAt: null,
          participants: { some: { userId, leftAt: null } },
        },
        include: {
          participants: {
            where: { leftAt: null },
            include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
          },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        skip, take: limit, orderBy: { updatedAt: 'desc' },
      }),
      prisma.conversation.count({
        where: { deletedAt: null, participants: { some: { userId, leftAt: null } } },
      }),
    ]);

    sendPaginated(res, data, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.post('/', validate(createConversationSchema), async (req, res, next) => {
  try {
    const dto = req.body as z.infer<typeof createConversationSchema>;
    const userId = req.user!.id;

    const allParticipantIds = [...new Set([userId, ...dto.participantIds])];

    // Pour les conversations 1-1, vérifier qu'elle n'existe pas déjà
    if (!dto.isGroup && allParticipantIds.length === 2) {
      const existing = await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          participants: { every: { userId: { in: allParticipantIds }, leftAt: null } },
        },
        include: { participants: true },
      });
      if (existing && existing.participants.length === 2) {
        sendSuccess(res, existing);
        return;
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        title: dto.title,
        isGroup: dto.isGroup,
        participants: {
          create: allParticipantIds.map((uid) => ({
            userId: uid,
            role: uid === userId ? 'admin' : 'member',
          })),
        },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });

    sendCreated(res, conversation, 'Conversation créée');
  } catch (err) { next(err); }
});

router.get('/:id/messages', async (req, res, next) => {
  try {
    const { page, limit, skip } = req.pagination!;
    const userId = req.user!.id;

    // Vérifier participation
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: req.params['id'], userId, leftAt: null },
    });
    if (!participant) throw new AppError('Vous ne participez pas à cette conversation', 403, 'NOT_PARTICIPANT');

    const [data, total] = await prisma.$transaction([
      prisma.message.findMany({
        where: { conversationId: req.params['id'], deletedAt: null },
        include: { sender: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
        skip, take: limit, orderBy: { createdAt: 'desc' },
      }),
      prisma.message.count({ where: { conversationId: req.params['id'], deletedAt: null } }),
    ]);

    sendPaginated(res, data.reverse(), buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: req.params['id'], userId, leftAt: null },
    });
    if (!participant) throw new AppError('Vous ne participez pas à cette conversation', 403, 'NOT_PARTICIPANT');

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params['id'], deletedAt: null },
      include: {
        participants: {
          where: { leftAt: null },
          include: { user: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
        },
      },
    });
    if (!conversation) throw new NotFoundError('Conversation');
    sendSuccess(res, conversation);
  } catch (err) { next(err); }
});

router.patch('/:id', validate(updateConversationSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: req.params['id'], userId, leftAt: null, role: 'admin' },
    });
    if (!participant) throw new AppError('Seul un administrateur peut modifier cette conversation', 403, 'FORBIDDEN');

    const conversation = await prisma.conversation.update({
      where: { id: req.params['id'] },
      data: { title: (req.body as { title: string }).title },
    });
    sendSuccess(res, conversation, 'Conversation mise à jour');
  } catch (err) { next(err); }
});

router.delete('/:id/leave', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: req.params['id'], userId, leftAt: null },
    });
    if (!participant) throw new AppError('Vous ne participez pas à cette conversation', 403, 'NOT_PARTICIPANT');

    await prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });
    sendSuccess(res, null, 'Vous avez quitté la conversation');
  } catch (err) { next(err); }
});

router.post('/:id/messages', validate(sendMessageSchema), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const dto = req.body as z.infer<typeof sendMessageSchema>;

    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId: req.params['id'], userId, leftAt: null },
    });
    if (!participant) throw new AppError('Vous ne participez pas à cette conversation', 403, 'NOT_PARTICIPANT');

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: req.params['id'], senderId: userId, content: dto.content, type: dto.type },
        include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.conversation.update({ where: { id: req.params['id'] }, data: { updatedAt: new Date() } }),
    ]);

    sendCreated(res, message, 'Message envoyé');
  } catch (err) { next(err); }
});

export default router;
