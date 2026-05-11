import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { requireRegionScope } from '../../middlewares/scope.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { districtsService } from './districts.service';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.util';
import {
  createDistrictSchema,
  updateDistrictSchema,
  listDistrictsQuerySchema,
  CreateDistrictDto,
  UpdateDistrictDto,
} from './districts.validation';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.DISTRICTS_READ), validate(listDistrictsQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { search, regionId, status, hasCoordinates, sortBy, sortOrder } = req.query as Record<string, string>;
    const result = await districtsService.list(
      req.pagination!,
      { search, regionId, status, hasCoordinates, sortBy, sortOrder },
      req.user!,
    );
    sendPaginated(res, result.data, result.pagination);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(PERMISSIONS.DISTRICTS_READ), async (req, res, next) => {
  try {
    sendSuccess(res, await districtsService.findById(req.params['id']!, req.user!));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission(PERMISSIONS.DISTRICTS_WRITE), requireRegionScope, validate(createDistrictSchema), async (req, res, next) => {
  try {
    sendCreated(
      res,
      await districtsService.create(req.body as CreateDistrictDto, req.user!.id, req, req.user!),
      'District cree',
    );
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission(PERMISSIONS.DISTRICTS_WRITE), validate(updateDistrictSchema), async (req, res, next) => {
  try {
    sendSuccess(
      res,
      await districtsService.update(req.params['id']!, req.body as UpdateDistrictDto, req.user!.id, req, req.user!),
      'District mis a jour',
    );
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission(PERMISSIONS.DISTRICTS_DELETE), async (req, res, next) => {
  try {
    await districtsService.softDelete(req.params['id']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'District supprime');
  } catch (err) {
    next(err);
  }
});

export default router;
