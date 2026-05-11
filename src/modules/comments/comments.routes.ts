import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { sendCreated, sendSuccess } from '../../utils/response.util';
import { commentsService, type CommentTarget } from './comments.service';
import { createCommentSchema } from './comments.validation';

export function createCommentsRouter(target: CommentTarget) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string | undefined>;
      const targetId = params['id']!;
      const comments = await commentsService.list(target, targetId, req.user!);
      sendSuccess(res, comments);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', validate(createCommentSchema), async (req, res, next) => {
    try {
      const params = req.params as Record<string, string | undefined>;
      const targetId = params['id']!;
      const comment = await commentsService.create(target, targetId, req.body, req.user!, req);
      sendCreated(res, comment, 'Commentaire cree');
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:commentId', async (req, res, next) => {
    try {
      const params = req.params as Record<string, string | undefined>;
      const targetId = params['id']!;
      await commentsService.remove(target, targetId, params['commentId']!, req.user!, req);
      sendSuccess(res, null, 'Commentaire supprime');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
