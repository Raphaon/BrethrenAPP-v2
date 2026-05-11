import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { sendSuccess } from '../../utils/response.util';
import { tenantsService } from './tenants.service';
import {
  updateTenantSchema,
  updateTenantSettingsSchema,
  type UpdateTenantDto,
  type UpdateTenantSettingsDto,
} from './tenants.validation';

const router = Router();

router.use(authenticate);

router.get('/me', async (req, res, next) => {
  try {
    const tenant = await tenantsService.getCurrentTenant(req.user!);
    sendSuccess(res, tenant);
  } catch (err) {
    next(err);
  }
});

router.patch('/me', validate(updateTenantSchema), async (req, res, next) => {
  try {
    const tenant = await tenantsService.updateCurrentTenant(req.user!, req.body as UpdateTenantDto);
    sendSuccess(res, tenant, 'Organisation mise à jour');
  } catch (err) {
    next(err);
  }
});

router.get('/me/usage', async (req, res, next) => {
  try {
    const usage = await tenantsService.getUsage(req.user!);
    sendSuccess(res, usage);
  } catch (err) {
    next(err);
  }
});

router.get('/me/settings', async (req, res, next) => {
  try {
    const settings = await tenantsService.getSettings(req.user!);
    sendSuccess(res, settings);
  } catch (err) {
    next(err);
  }
});

router.patch('/me/settings', validate(updateTenantSettingsSchema), async (req, res, next) => {
  try {
    const settings = await tenantsService.updateSettings(req.user!, req.body as UpdateTenantSettingsDto);
    sendSuccess(res, settings, 'Paramètres mis à jour');
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tenants = await tenantsService.listForPlatformAdmin(req.user!);
    sendSuccess(res, tenants);
  } catch (err) {
    next(err);
  }
});

// GET /me/onboarding — calcule dynamiquement la checklist d'onboarding
router.get('/me/onboarding', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) { sendSuccess(res, { steps: [], progress: 0 }); return; }

    const { prisma } = await import('../../database/prisma');

    const [tenant, memberCount, ministryCount, announcementCount, userCount, assemblyCount] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, logo: true } }),
      prisma.member.count({ where: { assembly: { district: { region: { tenantId } } }, deletedAt: null } }),
      prisma.ministry.count({ where: { assembly: { district: { region: { tenantId } } }, deletedAt: null } }),
      prisma.announcement.count({ where: { tenantId, deletedAt: null } }),
      prisma.user.count({ where: { tenantId, deletedAt: null } }),
      prisma.assembly.count({ where: { district: { region: { tenantId } }, deletedAt: null } }),
    ]);

    const steps = [
      { key: 'organization_created', label: 'Vérifier les informations de l’organisation', done: true, link: '/tenant' },
      { key: 'assembly_created', label: 'Ajouter une première assemblée', done: assemblyCount > 0, link: '/assemblies' },
      { key: 'add_logo', label: 'Personnaliser le logo et les contacts', done: !!tenant?.logo, link: '/settings' },
      { key: 'add_members', label: 'Ajouter les premiers membres', done: memberCount >= 5, link: '/members' },
      { key: 'create_ministries', label: 'Créer un ministère ou un groupe', done: ministryCount > 0, link: '/ministries' },
      { key: 'publish_announcement', label: 'Publier une annonce', done: announcementCount > 0, link: '/announcements' },
      { key: 'invite_admin', label: 'Inviter une personne de confiance', done: userCount > 1, link: '/users' },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    const progress = Math.round((doneCount / steps.length) * 100);

    sendSuccess(res, { steps, progress, doneCount, total: steps.length });
  } catch (err) { next(err); }
});

export default router;
