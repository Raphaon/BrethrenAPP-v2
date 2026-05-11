import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import { listRoles, getRole, createRole, updateRole, deleteRole, syncRolePermissions } from './roles.controller';
import { createRoleSchema, updateRoleSchema } from './roles.service';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.ROLES_READ), listRoles);
router.get('/:id', requirePermission(PERMISSIONS.ROLES_READ), getRole);
router.post('/', requirePermission(PERMISSIONS.ROLES_WRITE), validate(createRoleSchema), createRole);
router.patch('/:id', requirePermission(PERMISSIONS.ROLES_WRITE), validate(updateRoleSchema), updateRole);
router.delete('/:id', requirePermission(PERMISSIONS.ROLES_DELETE), deleteRole);
router.put('/:id/permissions', requirePermission(PERMISSIONS.ROLES_WRITE), syncRolePermissions);

export default router;
