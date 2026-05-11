import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { listRegions, getRegion, createRegion, updateRegion, deleteRegion } from './regions.controller';
import { createRegionSchema, updateRegionSchema, listRegionsQuerySchema } from './regions.validation';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.REGIONS_READ), validate(listRegionsQuerySchema, 'query'), listRegions);
router.get('/:id', requirePermission(PERMISSIONS.REGIONS_READ), getRegion);
router.post('/', requirePermission(PERMISSIONS.REGIONS_WRITE), validate(createRegionSchema), createRegion);
router.patch('/:id', requirePermission(PERMISSIONS.REGIONS_WRITE), validate(updateRegionSchema), updateRegion);
router.delete('/:id', requirePermission(PERMISSIONS.REGIONS_DELETE), deleteRegion);

export default router;
