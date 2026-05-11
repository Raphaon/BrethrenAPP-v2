import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticate } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { PERMISSIONS } from '../../shared/constants/permissions';
import {
  listUsers, getUser, createUser, updateUser, deleteUser,
  activateUser, deactivateUser, assignRole, removeRole, getSelf, updateSelf,
} from './users.controller';
import {
  createUserSchema, updateUserSchema, assignRoleSchema, listUsersQuerySchema, selfUpdateSchema,
} from './users.validation';
import { prisma } from '../../database/prisma';
import { emailService } from '../../services/email.service';
import { AppError, ConflictError } from '../../middlewares/error.middleware';
import { sendCreated } from '../../utils/response.util';
import { createAuditLog } from '../../utils/audit.util';
import { assertAssignableRole } from '../../utils/scope-access.util';

const inviteSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid().optional(),
  assemblyId: z.string().uuid().optional(),
});

const router = Router();

router.use(authenticate);

router.post('/:id/roles', requirePermission(PERMISSIONS.USERS_MANAGE_ROLES), validate(assignRoleSchema), assignRole);
router.delete('/:id/roles/:roleId', requirePermission(PERMISSIONS.USERS_MANAGE_ROLES), removeRole);

// Invitation
router.post('/invite', requirePermission(PERMISSIONS.USERS_WRITE), validate(inviteSchema), async (req, res, next) => {
  try {
    const { email, roleId, assemblyId } = req.body as z.infer<typeof inviteSchema>;
    const tenantId = req.user!.tenantId;
    if (!tenantId) throw new AppError('Aucune organisation associee a votre compte', 400, 'NO_TENANT');

    const existing = await prisma.user.findFirst({ where: { email: email.toLowerCase(), tenantId } });
    if (existing) throw new ConflictError('Un utilisateur avec cet email existe deja dans cette organisation');

    // Verifier que l'invitant a le droit d'attribuer ce role - meme regle que assignRole.
    // Cela empeche un admin d'inviter quelqu'un avec un role superieur au sien.
    if (roleId) {
      const role = await prisma.role.findUnique({ where: { id: roleId }, select: { name: true } });
      if (!role) throw new AppError('Role introuvable', 404, 'NOT_FOUND');
      await assertAssignableRole(req.user!, role.name, { assemblyId: assemblyId ?? null });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const inviter = req.user!;

    await prisma.invitationToken.updateMany({
      where: { email: email.toLowerCase(), tenantId, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invitation = await prisma.invitationToken.create({
      data: {
        id: crypto.randomUUID(),
        token: tokenHash,
        email: email.toLowerCase(),
        tenantId,
        roleId: roleId ?? null,
        assemblyId: assemblyId ?? null,
        invitedBy: inviter.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await emailService.sendInvitation(
      email,
      rawToken,
      `${inviter.firstName} ${inviter.lastName}`,
      tenant?.name ?? 'Brethren',
    );

    await createAuditLog({
      actorId: inviter.id,
      tenantId,
      action: 'CREATE',
      entityType: 'InvitationToken',
      entityId: invitation.id,
      newValues: { email, roleId, assemblyId },
      req,
    });

    sendCreated(res, { email, expiresAt: invitation.expiresAt }, 'Invitation envoyee');
  } catch (err) { next(err); }
});

// CRUD utilisateurs
router.get('/', requirePermission(PERMISSIONS.USERS_READ), validate(listUsersQuerySchema, 'query'), listUsers);
router.get('/me', getSelf);
router.get('/:id', requirePermission(PERMISSIONS.USERS_READ), getUser);
router.post('/', requirePermission(PERMISSIONS.USERS_WRITE), validate(createUserSchema), createUser);
router.patch('/me', validate(selfUpdateSchema), updateSelf);
router.patch('/:id', requirePermission(PERMISSIONS.USERS_WRITE), validate(updateUserSchema), updateUser);
router.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), deleteUser);
router.post('/:id/activate', requirePermission(PERMISSIONS.USERS_WRITE), activateUser);
router.post('/:id/deactivate', requirePermission(PERMISSIONS.USERS_WRITE), deactivateUser);

export default router;
