import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { requireDistrictScope } from '../../middlewares/scope.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { assembliesService } from './assemblies.service';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.util';
import {
  createAssemblySchema,
  updateAssemblySchema,
  listAssembliesQuerySchema,
  CreateAssemblyDto,
  UpdateAssemblyDto,
} from './assemblies.validation';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.ASSEMBLIES_READ), validate(listAssembliesQuerySchema, 'query'), async (req, res, next) => {
  try {
    const filters = req.query as Record<string, string>;
    const result = await assembliesService.list(req.pagination!, filters, req.user!);
    sendPaginated(res, result.data, result.pagination);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.ASSEMBLIES_READ), async (req, res, next) => {
  try {
    sendSuccess(res, await assembliesService.findById(req.params['id']!, req.user!));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.ASSEMBLIES_WRITE), requireDistrictScope, validate(createAssemblySchema), async (req, res, next) => {
  try {
    sendCreated(
      res,
      await assembliesService.create(req.body as CreateAssemblyDto, req.user!.id, req, req.user!),
      'Assemblee creee',
    );
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.ASSEMBLIES_WRITE), validate(updateAssemblySchema), async (req, res, next) => {
  try {
    sendSuccess(
      res,
      await assembliesService.update(req.params['id']!, req.body as UpdateAssemblyDto, req.user!.id, req, req.user!),
      'Assemblee mise a jour',
    );
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.ASSEMBLIES_DELETE), async (req, res, next) => {
  try {
    await assembliesService.softDelete(req.params['id']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'Assemblee supprimee');
  } catch (err) {
    next(err);
  }
});

export default router;
