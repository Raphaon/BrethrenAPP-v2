import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { permissionsService } from './permissions.service';
import { sendSuccess } from '../../utils/response.util';

const router = Router();
router.use(authenticate, requirePermission(PERMISSIONS.PERMISSIONS_READ));

router.get('/', async (req, res, next) => {
  try {
    const module = req.query['module'] as string | undefined;
    sendSuccess(res, await permissionsService.list(module));
  } catch (err) { next(err); }
});

router.get('/modules', async (_req, res, next) => {
  try { sendSuccess(res, await permissionsService.listModules()); } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try { sendSuccess(res, await permissionsService.findById(req.params['id']!)); } catch (err) { next(err); }
});

export default router;
