import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { transfersService, createTransferSchema, processTransferSchema } from './transfers.service';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.util';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.TRANSFERS_READ), async (req, res, next) => {
  try {
    const { memberId, fromAssemblyId, toAssemblyId, status } = req.query as Record<string, string>;
    const result = await transfersService.list(req.pagination!, { memberId, fromAssemblyId, toAssemblyId, status }, req.user!);
    sendPaginated(res, result.data, result.pagination);
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission(PERMISSIONS.TRANSFERS_READ), async (req, res, next) => {
  try { sendSuccess(res, await transfersService.findById(req.params['id']!, req.user!)); } catch (err) { next(err); }
});

router.post('/', requirePermission(PERMISSIONS.TRANSFERS_REQUEST), validate(createTransferSchema), async (req, res, next) => {
  try {
    const transfer = await transfersService.create(req.body as z.infer<typeof createTransferSchema>, req.user!, req);
    sendCreated(res, transfer, 'Demande de transfert soumise');
  } catch (err) { next(err); }
});

router.post('/:id/approve', requirePermission(PERMISSIONS.TRANSFERS_APPROVE), async (req, res, next) => {
  try {
    const transfer = await transfersService.approve(req.params['id']!, req.user!.id, req);
    sendSuccess(res, transfer, 'Transfert approuvé');
  } catch (err) { next(err); }
});

router.post('/:id/reject', requirePermission(PERMISSIONS.TRANSFERS_REJECT), validate(processTransferSchema), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body as z.infer<typeof processTransferSchema>;
    const transfer = await transfersService.reject(req.params['id']!, req.user!.id, rejectionReason ?? 'Aucun motif fourni', req);
    sendSuccess(res, transfer, 'Transfert rejeté');
  } catch (err) { next(err); }
});

export default router;
