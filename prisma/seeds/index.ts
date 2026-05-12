import 'dotenv/config';
import * as argon2 from 'argon2';
import {
  AuditAction,
  CommentTargetType,
  NotificationStatus,
  NotificationType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

type ScopeIds = {
  tenantId?: string | null;
  regionId?: string | null;
  districtId?: string | null;
  assemblyId?: string | null;
  ministryId?: string | null;
};

async function syncRolePermissions(roleId: string, permissionIds: string[]) {
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  if (!permissionIds.length) return;

  await prisma.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
    skipDuplicates: true,
  });
}

async function ensureUserRole(userId: string, roleId: string, scope: ScopeIds = {}, assignedBy?: string) {
  const existing = await prisma.userRole.findFirst({
    where: {
      userId,
      roleId,
      tenantId: scope.tenantId ?? null,
      regionId: scope.regionId ?? null,
      districtId: scope.districtId ?? null,
      assemblyId: scope.assemblyId ?? null,
      ministryId: scope.ministryId ?? null,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.userRole.create({
    data: {
      userId,
      roleId,
      assignedBy,
      tenantId: scope.tenantId ?? null,
      regionId: scope.regionId ?? null,
      districtId: scope.districtId ?? null,
      assemblyId: scope.assemblyId ?? null,
      ministryId: scope.ministryId ?? null,
    },
  });
}

async function ensureNotification(data: {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  status?: NotificationStatus;
  entityType?: string;
  entityId?: string;
  data?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.notification.findFirst({
    where: {
      userId: data.userId,
      title: data.title,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
    },
  });

  if (existing) {
    return prisma.notification.update({
      where: { id: existing.id },
      data: {
        message: data.message,
        type: data.type,
        status: data.status ?? existing.status,
        data: data.data,
      },
    });
  }

  return prisma.notification.create({
    data: {
      ...data,
      status: data.status ?? 'UNREAD',
    },
  });
}

async function ensureAuditLog(data: {
  actorId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}) {
  const existing = await prisma.auditLog.findFirst({
    where: {
      actorId: data.actorId ?? null,
      action: data.action,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
    },
  });

  if (existing) {
    return prisma.auditLog.update({
      where: { id: existing.id },
      data: {
        oldValues: data.oldValues,
        newValues: data.newValues,
        metadata: data.metadata,
      },
    });
  }

  return prisma.auditLog.create({ data });
}

async function ensureComment(data: {
  content: string;
  targetType: CommentTargetType;
  authorId: string;
  announcementId?: string;
  circularId?: string;
  eventId?: string;
}) {
  const existing = await prisma.comment.findFirst({
    where: {
      authorId: data.authorId,
      targetType: data.targetType,
      announcementId: data.announcementId ?? null,
      circularId: data.circularId ?? null,
      eventId: data.eventId ?? null,
      content: data.content,
      deletedAt: null,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.comment.create({ data });
}

async function ensureConversation(title: string, isGroup: boolean) {
  const existing = await prisma.conversation.findFirst({
    where: { title, isGroup, deletedAt: null },
  });

  if (existing) return existing;
  return prisma.conversation.create({ data: { title, isGroup } });
}

async function ensureConversationParticipant(conversationId: string, userId: string, role = 'member') {
  return prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId } },
    update: { role, leftAt: null },
    create: { conversationId, userId, role },
  });
}

async function ensureMessage(conversationId: string, senderId: string, content: string, type = 'text') {
  const existing = await prisma.message.findFirst({
    where: { conversationId, senderId, content, deletedAt: null },
  });

  if (existing) return existing;
  return prisma.message.create({
    data: { conversationId, senderId, content, type },
  });
}

async function ensureRegion(data: {
  tenantId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: string;
}) {
  const existing = await prisma.region.findFirst({
    where: {
      OR: [
        { tenantId: data.tenantId, name: data.name },
        ...(data.code ? [{ tenantId: data.tenantId, code: data.code }] : []),
      ],
    },
  });

  if (existing) {
    return prisma.region.update({
      where: { id: existing.id },
      data: { ...data, deletedAt: null },
    });
  }

  return prisma.region.create({ data });
}

async function ensureDistrict(data: {
  name: string;
  code?: string | null;
  description?: string | null;
  regionId: string;
  latitude?: number | null;
  longitude?: number | null;
  status?: string;
}) {
  const existing = await prisma.district.findFirst({
    where: {
      OR: [
        { name: data.name, regionId: data.regionId },
        ...(data.code ? [{ code: data.code }] : []),
      ],
    },
  });

  if (existing) {
    return prisma.district.update({
      where: { id: existing.id },
      data: { ...data, deletedAt: null },
    });
  }

  return prisma.district.create({ data });
}

async function ensureAssembly(data: {
  name: string;
  code?: string | null;
  address?: string | null;
  districtId: string;
  latitude?: number | null;
  longitude?: number | null;
  status?: string;
  phone?: string | null;
  email?: string | null;
  foundedAt?: Date | null;
}) {
  const existing = await prisma.assembly.findFirst({
    where: {
      OR: [
        { name: data.name, districtId: data.districtId },
        ...(data.code ? [{ code: data.code }] : []),
      ],
    },
  });

  if (existing) {
    return prisma.assembly.update({
      where: { id: existing.id },
      data: { ...data, deletedAt: null },
    });
  }

  return prisma.assembly.create({ data });
}

async function cleanupStaleData() {
  console.log('  Cleaning up stale / orphaned data...');

  // Keep only canonical region codes; delete anything that was created by old seeds
  // Cascade manually because FK constraints use RESTRICT
  const canonicalCodes = ['RC', 'RL'];
  const staleRegions = await prisma.region.findMany({
    where: { code: { notIn: canonicalCodes }, deletedAt: null },
    select: { id: true },
  });
  for (const region of staleRegions) {
    const staleDistricts = await prisma.district.findMany({ where: { regionId: region.id }, select: { id: true } });
    for (const district of staleDistricts) {
      const staleAssemblies = await prisma.assembly.findMany({ where: { districtId: district.id }, select: { id: true } });
      for (const assembly of staleAssemblies) {
        await prisma.member.deleteMany({ where: { assemblyId: assembly.id } });
        await prisma.assembly.delete({ where: { id: assembly.id } });
      }
      await prisma.district.delete({ where: { id: district.id } });
    }
    await prisma.region.delete({ where: { id: region.id } });
  }

  // Normalise region names to Title Case (idempotent on clean DB)
  await prisma.region.updateMany({ where: { code: 'RC' }, data: { name: 'Region Centre' } });
  await prisma.region.updateMany({ where: { code: 'RL' }, data: { name: 'Region Littoral' } });

  // Remove the stale role that was never part of the canonical set (cascade permissions first)
  const staleRoles = await prisma.role.findMany({ where: { name: 'reponsable_communication_regional' } });
  for (const r of staleRoles) {
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
    await prisma.userRole.deleteMany({ where: { roleId: r.id } });
    await prisma.role.delete({ where: { id: r.id } });
  }
}

async function main() {
  console.log('Starting comprehensive seed...');

  await cleanupStaleData();

  const permissionsData = [
    { name: 'users:read', displayName: 'Lire les utilisateurs', module: 'users', action: 'read' },
    { name: 'users:write', displayName: 'Creer ou modifier des utilisateurs', module: 'users', action: 'write' },
    { name: 'users:delete', displayName: 'Supprimer des utilisateurs', module: 'users', action: 'delete' },
    { name: 'users:manage_roles', displayName: 'Gerer les roles des utilisateurs', module: 'users', action: 'manage_roles' },
    { name: 'roles:read', displayName: 'Lire les roles', module: 'roles', action: 'read' },
    { name: 'roles:write', displayName: 'Creer ou modifier des roles', module: 'roles', action: 'write' },
    { name: 'roles:delete', displayName: 'Supprimer des roles', module: 'roles', action: 'delete' },
    { name: 'permissions:read', displayName: 'Lire les permissions', module: 'permissions', action: 'read' },
    { name: 'permissions:write', displayName: 'Modifier les permissions', module: 'permissions', action: 'write' },
    { name: 'regions:read', displayName: 'Lire les regions', module: 'regions', action: 'read' },
    { name: 'regions:write', displayName: 'Creer ou modifier des regions', module: 'regions', action: 'write' },
    { name: 'regions:delete', displayName: 'Supprimer des regions', module: 'regions', action: 'delete' },
    { name: 'districts:read', displayName: 'Lire les districts', module: 'districts', action: 'read' },
    { name: 'districts:write', displayName: 'Creer ou modifier des districts', module: 'districts', action: 'write' },
    { name: 'districts:delete', displayName: 'Supprimer des districts', module: 'districts', action: 'delete' },
    { name: 'assemblies:read', displayName: 'Lire les assemblees', module: 'assemblies', action: 'read' },
    { name: 'assemblies:write', displayName: 'Creer ou modifier des assemblees', module: 'assemblies', action: 'write' },
    { name: 'assemblies:delete', displayName: 'Supprimer des assemblees', module: 'assemblies', action: 'delete' },
    { name: 'preaching_points:read', displayName: 'Lire les points de preche', module: 'preaching_points', action: 'read' },
    { name: 'preaching_points:write', displayName: 'Creer ou modifier des points de preche', module: 'preaching_points', action: 'write' },
    { name: 'preaching_points:delete', displayName: 'Supprimer des points de preche', module: 'preaching_points', action: 'delete' },
    { name: 'members:read', displayName: 'Lire les membres', module: 'members', action: 'read' },
    { name: 'members:write', displayName: 'Creer ou modifier des membres', module: 'members', action: 'write' },
    { name: 'members:delete', displayName: 'Supprimer des membres', module: 'members', action: 'delete' },
    { name: 'pastors:read', displayName: 'Lire les pasteurs', module: 'pastors', action: 'read' },
    { name: 'pastors:write', displayName: 'Creer ou modifier des pasteurs', module: 'pastors', action: 'write' },
    { name: 'pastors:delete', displayName: 'Supprimer des pasteurs', module: 'pastors', action: 'delete' },
    { name: 'assignments:read', displayName: 'Lire les affectations', module: 'assignments', action: 'read' },
    { name: 'assignments:write', displayName: 'Creer ou modifier des affectations', module: 'assignments', action: 'write' },
    { name: 'assignments:delete', displayName: 'Supprimer des affectations', module: 'assignments', action: 'delete' },
    { name: 'ministries:read', displayName: 'Lire les ministeres', module: 'ministries', action: 'read' },
    { name: 'ministries:write', displayName: 'Creer ou modifier des ministeres', module: 'ministries', action: 'write' },
    { name: 'ministries:delete', displayName: 'Supprimer des ministeres', module: 'ministries', action: 'delete' },
    { name: 'announcements:read', displayName: 'Lire les annonces', module: 'announcements', action: 'read' },
    { name: 'announcements:write', displayName: 'Creer ou modifier des annonces', module: 'announcements', action: 'write' },
    { name: 'announcements:publish', displayName: 'Publier des annonces', module: 'announcements', action: 'publish' },
    { name: 'announcements:delete', displayName: 'Supprimer des annonces', module: 'announcements', action: 'delete' },
    { name: 'news:read', displayName: 'Lire les actualites', module: 'news', action: 'read' },
    { name: 'news:write', displayName: 'Creer ou modifier des actualites', module: 'news', action: 'write' },
    { name: 'news:publish', displayName: 'Publier des actualites', module: 'news', action: 'publish' },
    { name: 'news:delete', displayName: 'Supprimer des actualites', module: 'news', action: 'delete' },
    { name: 'circulars:read', displayName: 'Lire les circulaires', module: 'circulars', action: 'read' },
    { name: 'circulars:write', displayName: 'Creer ou modifier des circulaires', module: 'circulars', action: 'write' },
    { name: 'circulars:publish', displayName: 'Publier des circulaires', module: 'circulars', action: 'publish' },
    { name: 'circulars:delete', displayName: 'Supprimer des circulaires', module: 'circulars', action: 'delete' },
    { name: 'events:read', displayName: 'Lire les evenements', module: 'events', action: 'read' },
    { name: 'events:write', displayName: 'Creer ou modifier des evenements', module: 'events', action: 'write' },
    { name: 'events:publish', displayName: 'Publier des evenements', module: 'events', action: 'publish' },
    { name: 'events:delete', displayName: 'Supprimer des evenements', module: 'events', action: 'delete' },
    { name: 'transfers:read', displayName: 'Lire les transferts', module: 'transfers', action: 'read' },
    { name: 'transfers:request', displayName: 'Demander un transfert', module: 'transfers', action: 'request' },
    { name: 'transfers:approve', displayName: 'Approuver les transferts', module: 'transfers', action: 'approve' },
    { name: 'transfers:reject', displayName: 'Rejeter les transferts', module: 'transfers', action: 'reject' },
    { name: 'notifications:read', displayName: 'Lire les notifications', module: 'notifications', action: 'read' },
    { name: 'notifications:write', displayName: 'Envoyer des notifications', module: 'notifications', action: 'write' },
    { name: 'audit_logs:read', displayName: "Lire les logs d'audit", module: 'audit_logs', action: 'read' },
    { name: 'error_logs:read', displayName: "Lire les logs d'erreurs", module: 'error_logs', action: 'read' },
    { name: 'user_reports:read', displayName: 'Gerer les signalements utilisateurs', module: 'user_reports', action: 'read' },
    { name: 'statistics:read', displayName: 'Lire les statistiques', module: 'statistics', action: 'read' },
    { name: 'territory_accounts:read', displayName: 'Lire les comptes territoire', module: 'territory_accounts', action: 'read' },
    { name: 'territory_accounts:write', displayName: 'Gérer les comptes territoire', module: 'territory_accounts', action: 'write' },
    { name: 'territory_accounts:delete', displayName: 'Supprimer les comptes territoire', module: 'territory_accounts', action: 'delete' },
    { name: 'live_channels:create', displayName: 'Creer des sources live', module: 'live', action: 'create' },
    { name: 'live_channels:read', displayName: 'Lire les sources live', module: 'live', action: 'read' },
    { name: 'live_channels:update', displayName: 'Modifier les sources live', module: 'live', action: 'update' },
    { name: 'live_channels:delete', displayName: 'Desactiver les sources live', module: 'live', action: 'delete' },
    { name: 'live_services:create', displayName: 'Creer des services live', module: 'live', action: 'create' },
    { name: 'live_services:read', displayName: 'Lire les services live', module: 'live', action: 'read' },
    { name: 'live_services:update', displayName: 'Modifier les services live', module: 'live', action: 'update' },
    { name: 'live_services:publish', displayName: 'Publier les services live', module: 'live', action: 'publish' },
    { name: 'live_services:delete', displayName: 'Archiver les services live', module: 'live', action: 'delete' },
    { name: 'live_hosts:manage', displayName: 'Gerer les hotes live', module: 'live', action: 'manage' },
    { name: 'live_chat:moderate', displayName: 'Moderer le chat live', module: 'live', action: 'moderate' },
    { name: 'live_moments:manage', displayName: 'Gerer les moments live', module: 'live', action: 'manage' },
    { name: 'live_prayer:manage', displayName: 'Gerer les prieres live', module: 'live', action: 'manage' },
    { name: 'live_replays:manage', displayName: 'Gerer les replays', module: 'live', action: 'manage' },
    { name: 'live_analytics:read', displayName: 'Lire les statistiques live', module: 'live', action: 'read' },
    { name: 'live_settings:manage', displayName: 'Gerer les reglages live', module: 'live', action: 'manage' },
    { name: 'public_campaigns:create', displayName: 'Creer des campagnes portail', module: 'public_portal', action: 'create' },
    { name: 'public_campaigns:read', displayName: 'Lire les campagnes portail', module: 'public_portal', action: 'read' },
    { name: 'public_campaigns:update', displayName: 'Modifier les campagnes portail', module: 'public_portal', action: 'update' },
    { name: 'public_campaigns:activate', displayName: 'Activer les campagnes portail', module: 'public_portal', action: 'activate' },
    { name: 'public_campaigns:delete', displayName: 'Archiver les campagnes portail', module: 'public_portal', action: 'delete' },
    { name: 'public_links:create', displayName: 'Creer des liens portail', module: 'public_portal', action: 'create' },
    { name: 'public_links:read', displayName: 'Lire les liens portail', module: 'public_portal', action: 'read' },
    { name: 'public_qr_codes:generate', displayName: 'Generer des QR codes portail', module: 'public_portal', action: 'generate' },
    { name: 'public_submissions:read', displayName: 'Lire les soumissions portail', module: 'public_portal', action: 'read' },
    { name: 'public_submissions:export', displayName: 'Exporter les soumissions portail', module: 'public_portal', action: 'export' },
    { name: 'public_forms:manage', displayName: 'Gerer les formulaires portail', module: 'public_portal', action: 'manage' },
    { name: 'public_analytics:read', displayName: 'Lire les analytics portail', module: 'public_portal', action: 'read' },
    { name: 'public_settings:manage', displayName: 'Gerer les reglages portail', module: 'public_portal', action: 'manage' },
  ];

  console.log('  Syncing permissions...');
  for (const permission of permissionsData) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: permission,
      create: permission,
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const permissionByName = new Map(allPermissions.map((permission) => [permission.name, permission.id]));
  const pickPermissions = (names: string[]) => names.flatMap((name) => (permissionByName.has(name) ? [permissionByName.get(name)!] : []));
  const allPermissionIds = allPermissions.map((permission) => permission.id);

  const liveReadPermissionNames = [
    'live_channels:read',
    'live_services:read',
    'live_analytics:read',
  ];

  const liveOperationalPermissionNames = [
    'live_channels:create', 'live_channels:read', 'live_channels:update', 'live_channels:delete',
    'live_services:create', 'live_services:read', 'live_services:update', 'live_services:publish', 'live_services:delete',
    'live_hosts:manage', 'live_chat:moderate', 'live_moments:manage', 'live_prayer:manage',
    'live_replays:manage', 'live_analytics:read', 'live_settings:manage',
  ];

  const publicPortalReadPermissionNames = [
    'public_campaigns:read',
    'public_links:read',
    'public_qr_codes:generate',
    'public_submissions:read',
    'public_analytics:read',
  ];

  const publicPortalOperationalPermissionNames = [
    'public_campaigns:create', 'public_campaigns:read', 'public_campaigns:update', 'public_campaigns:activate', 'public_campaigns:delete',
    'public_links:create', 'public_links:read',
    'public_qr_codes:generate',
    'public_submissions:read', 'public_submissions:export',
    'public_forms:manage', 'public_analytics:read', 'public_settings:manage',
  ];

  const regionalPermissionNames = [
    'regions:read',
    'districts:read', 'districts:write', 'districts:delete',
    'assemblies:read', 'assemblies:write', 'assemblies:delete',
    'preaching_points:read', 'preaching_points:write', 'preaching_points:delete',
    'users:read', 'users:write', 'users:delete', 'users:manage_roles', 'roles:read',
    'members:read', 'members:write', 'members:delete',
    'pastors:read', 'pastors:write', 'pastors:delete',
    'assignments:read', 'assignments:write', 'assignments:delete',
    'ministries:read', 'ministries:write', 'ministries:delete',
    'announcements:read', 'announcements:write', 'announcements:publish', 'announcements:delete',
    'news:read', 'news:write', 'news:publish', 'news:delete',
    'circulars:read', 'circulars:write', 'circulars:publish', 'circulars:delete',
    'events:read', 'events:write', 'events:publish', 'events:delete',
    'transfers:read', 'transfers:approve', 'transfers:reject',
    'notifications:read', 'statistics:read', 'audit_logs:read',
    'territory_accounts:read', 'territory_accounts:write',
    ...liveReadPermissionNames,
    ...publicPortalReadPermissionNames,
  ];

  const districtPermissionNames = [
    'districts:read',
    'assemblies:read', 'assemblies:write', 'assemblies:delete',
    'preaching_points:read', 'preaching_points:write', 'preaching_points:delete',
    'users:read', 'users:write', 'users:delete', 'users:manage_roles', 'roles:read',
    'members:read', 'members:write', 'members:delete',
    'pastors:read', 'pastors:write',
    'assignments:read', 'assignments:write',
    'ministries:read', 'ministries:write', 'ministries:delete',
    'announcements:read', 'announcements:write', 'announcements:publish', 'announcements:delete',
    'news:read', 'news:write', 'news:publish', 'news:delete',
    'circulars:read', 'circulars:write', 'circulars:publish', 'circulars:delete',
    'events:read', 'events:write', 'events:publish', 'events:delete',
    'transfers:read', 'transfers:approve', 'transfers:reject',
    'notifications:read', 'statistics:read',
    'territory_accounts:read', 'territory_accounts:write',
    ...liveReadPermissionNames,
    ...publicPortalReadPermissionNames,
    'souls:read', 'fd:read', 'consolidation_reports:read',
  ];

  const assemblyPermissionNames = [
    'assemblies:read', 'preaching_points:read', 'preaching_points:write',
    'users:read', 'users:write', 'users:manage_roles', 'roles:read',
    'members:read', 'members:write',
    'ministries:read', 'ministries:write',
    'announcements:read', 'announcements:write', 'announcements:publish',
    'news:read', 'news:write', 'news:publish',
    'events:read', 'events:write', 'events:publish',
    'transfers:read', 'transfers:request',
    'notifications:read', 'statistics:read',
    'territory_accounts:read', 'territory_accounts:write',
    ...liveOperationalPermissionNames,
    ...publicPortalOperationalPermissionNames,
    'souls:read', 'souls:write', 'souls:assign', 'souls:archive',
    'fd:read', 'fd:write', 'fd:manage',
    'disciple_makers:manage',
    'followups:read', 'followups:write',
    'soul_attendance:manage',
    'consolidation_journeys:manage',
    'task_force:manage',
    'consolidation_reports:read',
  ];

  const ministryLeaderPermissionNames = [
    'members:read', 'announcements:read', 'news:read', 'circulars:read', 'events:read', 'notifications:read',
    'followups:read', 'followups:write', 'soul_attendance:manage',
  ];

  const memberPermissionNames = [
    'members:read', 'announcements:read', 'news:read', 'circulars:read', 'events:read', 'notifications:read',
  ];

  const rolesData = [
    {
      name: 'super_admin',
      displayName: 'Super Administrateur',
      description: 'Acces total plateforme',
      level: 1,
      isSystem: true,
      permissionIds: allPermissionIds,
    },
    {
      name: 'tenant_owner',
      displayName: "Responsable de l'organisation",
      description: "Gestion complète de l'organisation",
      level: 1,
      isSystem: true,
      permissionIds: allPermissionIds,
    },
    {
      name: 'tenant_admin',
      displayName: "Administrateur de l'organisation",
      description: "Administration complète de l'organisation",
      level: 1,
      isSystem: true,
      permissionIds: allPermissionIds,
    },
    {
      name: 'national_admin',
      displayName: 'Administrateur National',
      description: 'Administration nationale complete',
      level: 1,
      isSystem: true,
      permissionIds: allPermissionIds,
    },
    {
      name: 'regional_leader',
      displayName: 'Responsable Regional',
      description: 'Administration regionale decentralisee',
      level: 2,
      isSystem: false,
      permissionIds: pickPermissions(regionalPermissionNames),
    },
    {
      name: 'district_leader',
      displayName: 'Responsable de District',
      description: 'Administration de district',
      level: 3,
      isSystem: false,
      permissionIds: pickPermissions(districtPermissionNames),
    },
    {
      name: 'assembly_pastor',
      displayName: "Pasteur d'Assemblee",
      description: 'Gestion pastorale locale',
      level: 4,
      isSystem: false,
      permissionIds: pickPermissions(assemblyPermissionNames),
    },
    {
      name: 'assembly_admin',
      displayName: 'Administrateur Local',
      description: "Support administratif d'assemblee",
      level: 4,
      isSystem: false,
      permissionIds: pickPermissions(assemblyPermissionNames),
    },
    {
      name: 'ministry_leader',
      displayName: 'Leader de Ministere',
      description: 'Responsable de groupe ou ministere',
      level: 5,
      isSystem: false,
      permissionIds: pickPermissions(ministryLeaderPermissionNames),
    },
    {
      name: 'member',
      displayName: 'Membre',
      description: 'Membre simple',
      level: 5,
      isSystem: false,
      permissionIds: pickPermissions(memberPermissionNames),
    },
  ];

  console.log('  Syncing roles...');
  for (const roleData of rolesData) {
    const { permissionIds, ...roleCreate } = roleData;
    const role = await prisma.role.upsert({
      where: { name: roleCreate.name },
      update: {
        displayName: roleCreate.displayName,
        description: roleCreate.description,
        level: roleCreate.level,
        isSystem: roleCreate.isSystem,
      },
      create: roleCreate,
    });
    await syncRolePermissions(role.id, permissionIds);
  }

  const roleMap = new Map((await prisma.role.findMany()).map((role) => [role.name, role]));

  console.log('  Syncing SaaS plans and default tenant...');
  const planDefinitions = [
    {
      code: 'FREE' as const,
      name: 'Free',
      description: 'Plan gratuit pour demarrer une assemblee locale',
      monthlyPriceCents: 0,
      maxAssemblies: 1,
      maxMembers: 50,
      maxAdminUsers: 2,
      maxRegions: 0,
      maxDistricts: 0,
      maxPreachingPoints: 1,
      maxMinistries: 5,
      maxGroups: 5,
      allowRegions: false,
      allowDistricts: false,
      supportLevel: 'community',
    },
    {
      code: 'STARTER' as const,
      name: 'Starter',
      description: 'Pour une eglise locale en croissance',
      monthlyPriceCents: 2500,
      maxAssemblies: 1,
      maxMembers: 200,
      maxAdminUsers: 5,
      maxRegions: 0,
      maxDistricts: 0,
      maxPreachingPoints: 3,
      maxMinistries: 15,
      maxGroups: 20,
      supportLevel: 'email',
    },
    {
      code: 'PRO' as const,
      name: 'Pro',
      description: 'Planning, rapports et dons avances',
      monthlyPriceCents: 5900,
      maxAssemblies: 3,
      maxMembers: 1000,
      maxAdminUsers: 15,
      maxRegions: 0,
      maxDistricts: 3,
      maxPreachingPoints: 10,
      maxMinistries: null,
      maxGroups: null,
      allowDistricts: true,
      allowAdvancedReports: true,
      allowBranding: true,
      supportLevel: 'priority',
    },
    {
      code: 'PREMIUM' as const,
      name: 'Premium',
      description: 'Multi-assemblees et rapports consolides',
      monthlyPriceCents: 14900,
      maxAssemblies: 20,
      maxMembers: 10000,
      maxAdminUsers: 50,
      maxRegions: null,
      maxDistricts: null,
      maxPreachingPoints: null,
      maxMinistries: null,
      maxGroups: null,
      allowRegions: true,
      allowDistricts: true,
      allowAdvancedReports: true,
      allowBranding: true,
      allowPublicApi: true,
      supportLevel: 'priority',
    },
    {
      code: 'ENTERPRISE' as const,
      name: 'Enterprise',
      description: 'Pour federations et missions internationales',
      monthlyPriceCents: 0,
      maxAssemblies: null,
      maxMembers: null,
      maxAdminUsers: null,
      maxRegions: null,
      maxDistricts: null,
      maxPreachingPoints: null,
      maxMinistries: null,
      maxGroups: null,
      allowRegions: true,
      allowDistricts: true,
      allowAdvancedReports: true,
      allowBranding: true,
      allowPublicApi: true,
      supportLevel: 'dedicated',
    },
  ];

  for (const plan of planDefinitions) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { ...plan, updatedAt: new Date() },
      create: { id: crypto.randomUUID(), updatedAt: new Date(), ...plan },
    });
  }

  const premiumPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PREMIUM' } });
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: 'mpe-cameroun' },
    update: {
      name: 'Mission du Plein Evangile au Cameroun',
      country: 'CM',
      currency: 'XAF',
      language: 'fr',
      timezone: 'Africa/Douala',
      status: 'ACTIVE',
    },
    create: {
      id: crypto.randomUUID(),
      updatedAt: new Date(),
      name: 'Mission du Plein Evangile au Cameroun',
      slug: 'mpe-cameroun',
      country: 'CM',
      currency: 'XAF',
      language: 'fr',
      timezone: 'Africa/Douala',
      status: 'ACTIVE',
      tenantSettings: { create: { id: crypto.randomUUID(), updatedAt: new Date(), contactEmail: 'admin@mpe-cameroun.org' } },
    },
  });

  const existingSubscription = await prisma.subscription.findFirst({ where: { tenantId: defaultTenant.id } });
  if (existingSubscription) {
    await prisma.subscription.update({
      where: { id: existingSubscription.id },
      data: { planId: premiumPlan.id, status: 'ACTIVE', updatedAt: new Date() },
    });
  } else {
    await prisma.subscription.create({
      data: { id: crypto.randomUUID(), updatedAt: new Date(), tenantId: defaultTenant.id, planId: premiumPlan.id, status: 'ACTIVE' },
    });
  }

  console.log('  Creating geography...');

  const regionCentre = await ensureRegion({
    tenantId: defaultTenant.id,
    name: 'Region Centre',
    code: 'RC',
    description: 'Region Centre du Cameroun',
    latitude: 3.8667,
    longitude: 11.5167,
    status: 'ACTIVE',
  });

  const regionLittoral = await ensureRegion({
    tenantId: defaultTenant.id,
    name: 'Region Littoral',
    code: 'RL',
    description: 'Region Littoral du Cameroun',
    latitude: 4.0511,
    longitude: 9.7679,
    status: 'ACTIVE',
  });

  const districtYaounde1 = await ensureDistrict({
    name: 'District de Yaounde I',
    code: 'DYI',
    regionId: regionCentre.id,
    latitude: 3.848,
    longitude: 11.5021,
    status: 'ACTIVE',
  });

  const districtMfoundi = await ensureDistrict({
    name: 'District de Mfoundi',
    code: 'DMF',
    regionId: regionCentre.id,
    latitude: 3.879,
    longitude: 11.517,
    status: 'ACTIVE',
  });

  const districtDouala1 = await ensureDistrict({
    name: 'District de Douala I',
    code: 'DDI',
    regionId: regionLittoral.id,
    latitude: 4.0624,
    longitude: 9.7043,
    status: 'ACTIVE',
  });

  const assemblyYaoundeCentral = await ensureAssembly({
    name: 'Assemblee Centrale de Yaounde',
    code: 'ACY',
    address: 'Avenue de la Paix, Yaounde',
    districtId: districtYaounde1.id,
    latitude: 3.848,
    longitude: 11.5021,
    phone: '+237 222 000 001',
    email: 'acy@mpe-cameroun.org',
    foundedAt: new Date('1980-01-01'),
    status: 'ACTIVE',
  });

  const assemblyNsimeyong = await ensureAssembly({
    name: 'Assemblee de Nsimeyong',
    code: 'ANS',
    address: 'Nsimeyong, Yaounde',
    districtId: districtMfoundi.id,
    latitude: 3.826,
    longitude: 11.498,
    phone: '+237 222 000 021',
    email: 'nsimeyong@mpe-cameroun.org',
    foundedAt: new Date('1995-08-20'),
    status: 'ACTIVE',
  });

  const assemblyDoualaBonaberi = await ensureAssembly({
    name: 'Assemblee de Bonaberi',
    code: 'ADB',
    address: 'Bonaberi, Douala',
    districtId: districtDouala1.id,
    latitude: 4.071,
    longitude: 9.681,
    phone: '+237 233 000 111',
    email: 'bonaberi@mpe-cameroun.org',
    foundedAt: new Date('1992-03-12'),
    status: 'ACTIVE',
  });

  const preachingPointMendong =
    (await prisma.preachingPoint.findFirst({
      where: { name: 'Point de Preche Mendong', assemblyId: assemblyYaoundeCentral.id },
    })) ??
    (await prisma.preachingPoint.create({
      data: {
        name: 'Point de Preche Mendong',
        address: 'Quartier Mendong, Yaounde',
        assemblyId: assemblyYaoundeCentral.id,
        latitude: 3.82,
        longitude: 11.49,
        phone: '+237 677 555 100',
      },
    }));

  const preachingPointNdogpassi =
    (await prisma.preachingPoint.findFirst({
      where: { name: 'Point de Preche Ndogpassi', assemblyId: assemblyDoualaBonaberi.id },
    })) ??
    (await prisma.preachingPoint.create({
      data: {
        name: 'Point de Preche Ndogpassi',
        address: 'Ndogpassi, Douala',
        assemblyId: assemblyDoualaBonaberi.id,
        latitude: 4.072,
        longitude: 9.742,
        phone: '+237 677 555 200',
      },
    }));

  console.log('  Creating members...');

  const members = {
    pastorCentre: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00001' },
      update: {},
      create: {
        matricule: 'ACY-24-00001',
        firstName: 'Emmanuel',
        lastName: 'NKOMO',
        gender: 'MALE',
        phone: '+237 677 000 001',
        email: 'pastor.nkomo@mpe-cameroun.org',
        assemblyId: assemblyYaoundeCentral.id,
        status: 'ACTIVE',
        memberSince: new Date('1995-06-01'),
        baptismDate: new Date('1995-09-15'),
        salvationDate: new Date('1993-03-12'),
        profession: 'Pasteur',
      },
    }),
    choirLeader: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00002' },
      update: {},
      create: {
        matricule: 'ACY-24-00002',
        firstName: 'Marie',
        lastName: 'BIYONG',
        gender: 'FEMALE',
        phone: '+237 677 000 002',
        email: 'marie.biyong@mpe-cameroun.org',
        assemblyId: assemblyYaoundeCentral.id,
        status: 'ACTIVE',
        memberSince: new Date('2010-03-15'),
      },
    }),
    youthLeader: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00003' },
      update: {},
      create: {
        matricule: 'ACY-24-00003',
        firstName: 'Paul',
        lastName: 'ESSAMA',
        gender: 'MALE',
        phone: '+237 677 000 003',
        email: 'paul.essama@mpe-cameroun.org',
        assemblyId: assemblyYaoundeCentral.id,
        status: 'ACTIVE',
        memberSince: new Date('2015-07-20'),
      },
    }),
    assemblyAdminMember: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00005' },
      update: {},
      create: {
        matricule: 'ACY-24-00005',
        firstName: 'Prisca',
        lastName: 'ATANGA',
        gender: 'FEMALE',
        phone: '+237 677 000 005',
        email: 'assembly.admin@mpe-cameroun.org',
        assemblyId: assemblyYaoundeCentral.id,
        status: 'ACTIVE',
        memberSince: new Date('2014-09-10'),
        profession: 'Assistante administrative',
      },
    }),
    ministryLeaderMember: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00006' },
      update: {},
      create: {
        matricule: 'ACY-24-00006',
        firstName: 'Lionel',
        lastName: 'ABOGO',
        gender: 'MALE',
        phone: '+237 677 000 006',
        email: 'ministry.leader@mpe-cameroun.org',
        assemblyId: assemblyYaoundeCentral.id,
        status: 'ACTIVE',
        memberSince: new Date('2016-04-22'),
        profession: 'Coordinateur jeunesse',
      },
    }),
    districtLeaderMember: await prisma.member.upsert({
      where: { matricule: 'ANS-24-00001' },
      update: {},
      create: {
        matricule: 'ANS-24-00001',
        firstName: 'Joseph',
        lastName: 'MINKO',
        gender: 'MALE',
        phone: '+237 677 010 010',
        email: 'joseph.minko@mpe-cameroun.org',
        assemblyId: assemblyNsimeyong.id,
        status: 'ACTIVE',
        memberSince: new Date('2008-01-01'),
        profession: 'Administrateur',
      },
    }),
    regionalLeaderMember: await prisma.member.upsert({
      where: { matricule: 'ADB-24-00001' },
      update: {},
      create: {
        matricule: 'ADB-24-00001',
        firstName: 'Rachel',
        lastName: 'EWANE',
        gender: 'FEMALE',
        phone: '+237 677 020 020',
        email: 'rachel.ewane@mpe-cameroun.org',
        assemblyId: assemblyDoualaBonaberi.id,
        status: 'ACTIVE',
        memberSince: new Date('2006-04-10'),
        profession: 'Responsable regionale',
      },
    }),
    transferredMember: await prisma.member.upsert({
      where: { matricule: 'ACY-24-00004' },
      update: {},
      create: {
        matricule: 'ACY-24-00004',
        firstName: 'Denis',
        lastName: 'OBAM',
        gender: 'MALE',
        phone: '+237 677 000 004',
        email: 'denis.obam@mpe-cameroun.org',
        assemblyId: assemblyDoualaBonaberi.id,
        status: 'TRANSFERRED',
        memberSince: new Date('2012-11-08'),
        notes: 'Transfere vers Douala Bonaberi',
      },
    }),
    inactiveMember: await prisma.member.upsert({
      where: { matricule: 'ADB-24-00002' },
      update: {},
      create: {
        matricule: 'ADB-24-00002',
        firstName: 'Esther',
        lastName: 'TAMO',
        gender: 'FEMALE',
        phone: '+237 677 020 021',
        email: 'esther.tamo@mpe-cameroun.org',
        assemblyId: assemblyDoualaBonaberi.id,
        status: 'INACTIVE',
        memberSince: new Date('2018-02-14'),
      },
    }),
  };

  await prisma.member.update({
    where: { id: members.transferredMember.id },
    data: { preachingPointId: preachingPointNdogpassi.id },
  });

  await prisma.member.update({
    where: { id: members.choirLeader.id },
    data: { preachingPointId: preachingPointMendong.id },
  });

  console.log('  Creating pastors and assignments...');

  const pastorCentre = await prisma.pastor.upsert({
    where: { memberId: members.pastorCentre.id },
    update: {},
    create: {
      memberId: members.pastorCentre.id,
      title: 'Pasteur',
      ordainedAt: new Date('2000-01-01'),
      assemblyId: assemblyYaoundeCentral.id,
    },
  });

  const pastorDistrict = await prisma.pastor.upsert({
    where: { memberId: members.districtLeaderMember.id },
    update: {},
    create: {
      memberId: members.districtLeaderMember.id,
      title: 'Ancien',
      ordainedAt: new Date('2011-05-15'),
      assemblyId: assemblyNsimeyong.id,
    },
  });

  const pastorRegional = await prisma.pastor.upsert({
    where: { memberId: members.regionalLeaderMember.id },
    update: {},
    create: {
      memberId: members.regionalLeaderMember.id,
      title: 'Pasteur',
      ordainedAt: new Date('2009-09-09'),
      assemblyId: assemblyDoualaBonaberi.id,
    },
  });

  const assignmentKeys = [
    {
      pastorId: pastorCentre.id,
      assemblyId: assemblyYaoundeCentral.id,
      districtId: null,
      regionId: null,
      entityType: 'assembly',
      role: 'Pasteur Titulaire',
      startDate: new Date('2005-01-01'),
      status: 'ACTIVE' as const,
    },
    {
      pastorId: pastorDistrict.id,
      assemblyId: null,
      districtId: districtMfoundi.id,
      regionId: null,
      entityType: 'district',
      role: 'Coordinateur de District',
      startDate: new Date('2018-01-01'),
      status: 'ACTIVE' as const,
    },
    {
      pastorId: pastorRegional.id,
      assemblyId: null,
      districtId: null,
      regionId: regionLittoral.id,
      entityType: 'region',
      role: 'Coordinatrice Regionale',
      startDate: new Date('2020-01-01'),
      status: 'ACTIVE' as const,
    },
  ];

  for (const assignment of assignmentKeys) {
    const existing = await prisma.assignment.findFirst({
      where: {
        pastorId: assignment.pastorId,
        entityType: assignment.entityType,
        assemblyId: assignment.assemblyId,
        districtId: assignment.districtId,
        regionId: assignment.regionId,
        status: assignment.status,
      },
    });

    if (!existing) {
      await prisma.assignment.create({ data: assignment });
    }
  }

  const closedAssignment = await prisma.assignment.findFirst({
    where: {
      pastorId: pastorCentre.id,
      entityType: 'assembly',
      assemblyId: assemblyNsimeyong.id,
      status: 'CLOSED',
    },
  });

  if (!closedAssignment) {
    await prisma.assignment.create({
      data: {
        pastorId: pastorCentre.id,
        entityType: 'assembly',
        assemblyId: assemblyNsimeyong.id,
        role: 'Pasteur Invite',
        startDate: new Date('2016-01-01'),
        endDate: new Date('2017-06-30'),
        status: 'CLOSED',
        notes: 'Mission temporaire avant retour a Yaounde',
      },
    });
  }

  console.log('  Creating ministries and memberships...');

  const choirMinistry = await prisma.ministry.upsert({
    where: { name_assemblyId: { name: 'Chorale Bethel', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      name: 'Chorale Bethel',
      assemblyId: assemblyYaoundeCentral.id,
      type: 'choir',
      leaderId: members.choirLeader.id,
    },
  });

  const youthMinistry = await prisma.ministry.upsert({
    where: { name_assemblyId: { name: 'Jeunesse en Marche', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      name: 'Jeunesse en Marche',
      assemblyId: assemblyYaoundeCentral.id,
      type: 'youth',
      leaderId: members.youthLeader.id,
    },
  });

  const womenMinistry = await prisma.ministry.upsert({
    where: { name_assemblyId: { name: 'Femmes de Foi', assemblyId: assemblyDoualaBonaberi.id } },
    update: {},
    create: {
      name: 'Femmes de Foi',
      assemblyId: assemblyDoualaBonaberi.id,
      type: 'women',
      leaderId: members.regionalLeaderMember.id,
    },
  });

  const ministryMemberships = [
    { ministryId: choirMinistry.id, memberId: members.choirLeader.id, role: 'leader' },
    { ministryId: choirMinistry.id, memberId: members.youthLeader.id, role: 'assistant' },
    { ministryId: youthMinistry.id, memberId: members.youthLeader.id, role: 'leader' },
    { ministryId: youthMinistry.id, memberId: members.choirLeader.id, role: 'member' },
    { ministryId: womenMinistry.id, memberId: members.regionalLeaderMember.id, role: 'leader' },
    { ministryId: womenMinistry.id, memberId: members.inactiveMember.id, role: 'member' },
  ];

  for (const membership of ministryMemberships) {
    await prisma.ministryMember.upsert({
      where: { ministryId_memberId: { ministryId: membership.ministryId, memberId: membership.memberId } },
      update: { role: membership.role, status: 'ACTIVE' },
      create: { ...membership, status: 'ACTIVE' },
    });
  }

  console.log('  Creating users and auth artifacts...');

  const hashedPasswords = {
    admin: await argon2.hash('Admin@2024!'),
    national: await argon2.hash('National@2024!'),
    regional: await argon2.hash('Regional@2024!'),
    district: await argon2.hash('District@2024!'),
    pastor: await argon2.hash('Pastor@2024!'),
    localAdmin: await argon2.hash('Assembly@2024!'),
    ministry: await argon2.hash('Ministry@2024!'),
    member: await argon2.hash('Member@2024!'),
  };

  const users = {
    superAdmin: await prisma.user.upsert({
      where: { email: 'admin@mpe-cameroun.org' },
      update: { status: 'ACTIVE' },
      create: {
        email: 'admin@mpe-cameroun.org',
        firstName: 'Admin',
        lastName: 'National',
        password: hashedPasswords.admin,
        status: 'ACTIVE',
        phone: '+237 690 000 001',
      },
    }),
    nationalAdmin: await prisma.user.upsert({
      where: { email: 'national.admin@mpe-cameroun.org' },
      update: { status: 'ACTIVE' },
      create: {
        email: 'national.admin@mpe-cameroun.org',
        firstName: 'Samuel',
        lastName: 'MEYONG',
        password: hashedPasswords.national,
        status: 'ACTIVE',
        phone: '+237 690 000 002',
      },
    }),
    regionalLeader: await prisma.user.upsert({
      where: { email: 'rachel.ewane@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.regionalLeaderMember.id },
      create: {
        email: 'rachel.ewane@mpe-cameroun.org',
        firstName: 'Rachel',
        lastName: 'EWANE',
        password: hashedPasswords.regional,
        status: 'ACTIVE',
        phone: '+237 690 000 003',
        memberId: members.regionalLeaderMember.id,
      },
    }),
    districtLeader: await prisma.user.upsert({
      where: { email: 'joseph.minko@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.districtLeaderMember.id },
      create: {
        email: 'joseph.minko@mpe-cameroun.org',
        firstName: 'Joseph',
        lastName: 'MINKO',
        password: hashedPasswords.district,
        status: 'ACTIVE',
        phone: '+237 690 000 004',
        memberId: members.districtLeaderMember.id,
      },
    }),
    pastor: await prisma.user.upsert({
      where: { email: 'pastor.nkomo@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.pastorCentre.id },
      create: {
        email: 'pastor.nkomo@mpe-cameroun.org',
        firstName: 'Emmanuel',
        lastName: 'NKOMO',
        password: hashedPasswords.pastor,
        status: 'ACTIVE',
        phone: '+237 690 000 005',
        memberId: members.pastorCentre.id,
      },
    }),
    assemblyAdmin: await prisma.user.upsert({
      where: { email: 'assembly.admin@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.assemblyAdminMember.id },
      create: {
        email: 'assembly.admin@mpe-cameroun.org',
        firstName: 'Prisca',
        lastName: 'ATANGA',
        password: hashedPasswords.localAdmin,
        status: 'ACTIVE',
        phone: '+237 690 000 006',
        memberId: members.assemblyAdminMember.id,
      },
    }),
    ministryLeader: await prisma.user.upsert({
      where: { email: 'ministry.leader@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.ministryLeaderMember.id },
      create: {
        email: 'ministry.leader@mpe-cameroun.org',
        firstName: 'Lionel',
        lastName: 'ABOGO',
        password: hashedPasswords.ministry,
        status: 'ACTIVE',
        phone: '+237 690 000 007',
        memberId: members.ministryLeaderMember.id,
      },
    }),
    member: await prisma.user.upsert({
      where: { email: 'member.denis@mpe-cameroun.org' },
      update: { status: 'ACTIVE', memberId: members.transferredMember.id },
      create: {
        email: 'member.denis@mpe-cameroun.org',
        firstName: 'Denis',
        lastName: 'OBAM',
        password: hashedPasswords.member,
        status: 'ACTIVE',
        phone: '+237 690 000 008',
        memberId: members.transferredMember.id,
      },
    }),
  };

  await prisma.user.updateMany({
    where: { id: { in: Object.values(users).map((user) => user.id) } },
    data: { tenantId: defaultTenant.id },
  });

  await prisma.tenant.update({ where: { id: defaultTenant.id }, data: { ownerId: users.nationalAdmin.id } });

  await ensureUserRole(users.superAdmin.id, roleMap.get('super_admin')!.id);
  await ensureUserRole(users.nationalAdmin.id, roleMap.get('tenant_owner')!.id, { tenantId: defaultTenant.id }, users.superAdmin.id);
  await ensureUserRole(users.nationalAdmin.id, roleMap.get('national_admin')!.id, { tenantId: defaultTenant.id }, users.superAdmin.id);
  await ensureUserRole(users.regionalLeader.id, roleMap.get('regional_leader')!.id, { tenantId: defaultTenant.id, regionId: regionLittoral.id }, users.superAdmin.id);
  await ensureUserRole(users.districtLeader.id, roleMap.get('district_leader')!.id, { tenantId: defaultTenant.id, districtId: districtMfoundi.id }, users.superAdmin.id);
  await ensureUserRole(users.pastor.id, roleMap.get('assembly_pastor')!.id, { tenantId: defaultTenant.id, assemblyId: assemblyYaoundeCentral.id }, users.superAdmin.id);
  await ensureUserRole(users.assemblyAdmin.id, roleMap.get('assembly_admin')!.id, { tenantId: defaultTenant.id, assemblyId: assemblyYaoundeCentral.id }, users.pastor.id);
  await ensureUserRole(users.ministryLeader.id, roleMap.get('ministry_leader')!.id, { tenantId: defaultTenant.id, assemblyId: assemblyYaoundeCentral.id, ministryId: youthMinistry.id }, users.pastor.id);
  await ensureUserRole(users.member.id, roleMap.get('member')!.id, { tenantId: defaultTenant.id, assemblyId: assemblyDoualaBonaberi.id }, users.pastor.id);

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.upsert({
    where: { token: 'seed-refresh-super-admin' },
    update: { userId: users.superAdmin.id, expiresAt: in30Days, revokedAt: null, ipAddress: '127.0.0.1', userAgent: 'seed-script' },
    create: {
      token: 'seed-refresh-super-admin',
      userId: users.superAdmin.id,
      expiresAt: in30Days,
      ipAddress: '127.0.0.1',
      userAgent: 'seed-script',
    },
  });

  await prisma.refreshToken.upsert({
    where: { token: 'seed-refresh-pastor' },
    update: { userId: users.pastor.id, expiresAt: in7Days, ipAddress: '127.0.0.1', userAgent: 'seed-script-mobile' },
    create: {
      token: 'seed-refresh-pastor',
      userId: users.pastor.id,
      expiresAt: in7Days,
      ipAddress: '127.0.0.1',
      userAgent: 'seed-script-mobile',
    },
  });

  await prisma.passwordResetToken.upsert({
    where: { token: 'seed-reset-super-admin' },
    update: { userId: users.superAdmin.id, expiresAt: in7Days, usedAt: null },
    create: {
      token: 'seed-reset-super-admin',
      userId: users.superAdmin.id,
      expiresAt: in7Days,
    },
  });

  await prisma.passwordResetToken.upsert({
    where: { token: 'seed-reset-member' },
    update: { userId: users.member.id, expiresAt: in7Days, usedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    create: {
      token: 'seed-reset-member',
      userId: users.member.id,
      expiresAt: in7Days,
      usedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    },
  });

  console.log('  Creating transfers...');

  const approvedTransfer =
    (await prisma.transfer.findFirst({
      where: {
        memberId: members.transferredMember.id,
        fromAssemblyId: assemblyYaoundeCentral.id,
        toAssemblyId: assemblyDoualaBonaberi.id,
      },
    })) ??
    (await prisma.transfer.create({
      data: {
        memberId: members.transferredMember.id,
        fromAssemblyId: assemblyYaoundeCentral.id,
        toAssemblyId: assemblyDoualaBonaberi.id,
        requestedBy: users.pastor.id,
        approvedBy: users.superAdmin.id,
        reason: 'Mutation professionnelle vers Douala',
        status: 'APPROVED',
        requestedAt: new Date('2024-11-10'),
        processedAt: new Date('2024-11-15'),
        effectiveDate: new Date('2024-12-01'),
        notes: 'Transfert valide par le bureau national',
      },
    }));

  const pendingTransfer =
    (await prisma.transfer.findFirst({
      where: {
        memberId: members.choirLeader.id,
        fromAssemblyId: assemblyYaoundeCentral.id,
        toAssemblyId: assemblyNsimeyong.id,
        status: 'PENDING',
      },
    })) ??
    (await prisma.transfer.create({
      data: {
        memberId: members.choirLeader.id,
        fromAssemblyId: assemblyYaoundeCentral.id,
        toAssemblyId: assemblyNsimeyong.id,
        requestedBy: users.assemblyAdmin.id,
        reason: 'Rapprochement familial',
        status: 'PENDING',
        requestedAt: new Date('2026-03-12'),
      },
    }));

  console.log('  Creating publications...');

  const nationalAnnouncement = await prisma.announcement.upsert({
    where: { id: '0f9e4a2c-1e36-4f96-9a1c-000000000001' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '0f9e4a2c-1e36-4f96-9a1c-000000000001',
      tenantId: defaultTenant.id,
      title: 'Convention nationale 2026',
      content: 'La convention nationale se tiendra a Yaounde avec toutes les regions representees.',
      level: 'NATIONAL',
      status: 'PUBLISHED',
      authorId: users.nationalAdmin.id,
      publishedAt: new Date('2026-01-05'),
      attachments: ['https://example.com/docs/convention-2026.pdf'],
    },
  });

  const regionalAnnouncement = await prisma.announcement.upsert({
    where: { id: '0f9e4a2c-1e36-4f96-9a1c-000000000002' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '0f9e4a2c-1e36-4f96-9a1c-000000000002',
      tenantId: defaultTenant.id,
      title: 'Seminaire regional Littoral',
      content: 'Les responsables locaux du Littoral sont convoques pour un seminaire de planification.',
      level: 'REGIONAL',
      status: 'PUBLISHED',
      authorId: users.regionalLeader.id,
      regionId: regionLittoral.id,
      publishedAt: new Date('2026-02-10'),
    },
  });

  const assemblyAnnouncement = await prisma.announcement.upsert({
    where: { id: '0f9e4a2c-1e36-4f96-9a1c-000000000003' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '0f9e4a2c-1e36-4f96-9a1c-000000000003',
      tenantId: defaultTenant.id,
      title: 'Veillee de prieres de vendredi',
      content: "L'assemblee centrale organise une veillee de prieres vendredi des 22h.",
      level: 'ASSEMBLY',
      status: 'PUBLISHED',
      authorId: users.pastor.id,
      assemblyId: assemblyYaoundeCentral.id,
      publishedAt: new Date('2026-03-01'),
    },
  });

  const ministryAnnouncement = await prisma.announcement.upsert({
    where: { id: '0f9e4a2c-1e36-4f96-9a1c-000000000004' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '0f9e4a2c-1e36-4f96-9a1c-000000000004',
      tenantId: defaultTenant.id,
      title: 'Repetition speciale jeunesse',
      content: 'La jeunesse se retrouve samedi pour une repetition generale avant la croisade.',
      level: 'MINISTRY',
      status: 'PUBLISHED',
      authorId: users.ministryLeader.id,
      ministryId: youthMinistry.id,
      publishedAt: new Date('2026-03-15'),
    },
  });

  const nationalCircular = await prisma.circular.upsert({
    where: { reference: 'CIRC-2026-001' },
    update: { tenantId: defaultTenant.id },
    create: {
      reference: 'CIRC-2026-001',
      tenantId: defaultTenant.id,
      title: 'Directive nationale de gouvernance',
      content: 'Cette circulaire fixe les exigences de reporting de toutes les regions.',
      level: 'NATIONAL',
      status: 'PUBLISHED',
      authorId: users.nationalAdmin.id,
      publishedAt: new Date('2026-01-12'),
      attachments: ['https://example.com/docs/directive-gouvernance.pdf'],
    },
  });

  const districtCircular = await prisma.circular.upsert({
    where: { reference: 'CIRC-DMF-2026-002' },
    update: { tenantId: defaultTenant.id },
    create: {
      reference: 'CIRC-DMF-2026-002',
      tenantId: defaultTenant.id,
      title: 'Reunion des responsables de district',
      content: 'Tous les responsables du district de Mfoundi sont attendus lundi a 9h.',
      level: 'DISTRICT',
      status: 'PUBLISHED',
      authorId: users.districtLeader.id,
      districtId: districtMfoundi.id,
      publishedAt: new Date('2026-03-20'),
    },
  });

  const nationalEvent = await prisma.event.upsert({
    where: { id: '7a44d5b6-bec9-4ee8-8e53-000000000001' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '7a44d5b6-bec9-4ee8-8e53-000000000001',
      tenantId: defaultTenant.id,
      title: 'Convention nationale',
      description: 'Grand rassemblement annuel de la Mission du Plein Evangile.',
      startDate: new Date('2026-08-12T09:00:00Z'),
      endDate: new Date('2026-08-15T16:00:00Z'),
      location: 'Palais des Sports, Yaounde',
      latitude: 3.8796,
      longitude: 11.5174,
      level: 'NATIONAL',
      status: 'PUBLISHED',
      authorId: users.nationalAdmin.id,
      isPublic: true,
    },
  });

  const districtEvent = await prisma.event.upsert({
    where: { id: '7a44d5b6-bec9-4ee8-8e53-000000000002' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '7a44d5b6-bec9-4ee8-8e53-000000000002',
      tenantId: defaultTenant.id,
      title: 'Retraite du district',
      description: 'Retraite spirituelle du district de Mfoundi.',
      startDate: new Date('2026-05-18T08:00:00Z'),
      endDate: new Date('2026-05-18T18:00:00Z'),
      location: 'Centre de retraites de Mvolye',
      level: 'DISTRICT',
      status: 'PUBLISHED',
      authorId: users.districtLeader.id,
      districtId: districtMfoundi.id,
      isPublic: true,
    },
  });

  const assemblyEvent = await prisma.event.upsert({
    where: { id: '7a44d5b6-bec9-4ee8-8e53-000000000003' },
    update: { tenantId: defaultTenant.id },
    create: {
      id: '7a44d5b6-bec9-4ee8-8e53-000000000003',
      tenantId: defaultTenant.id,
      title: 'Culte special famille',
      description: 'Culte et benediction des familles de l assemblee centrale.',
      startDate: new Date('2026-04-26T08:30:00Z'),
      endDate: new Date('2026-04-26T12:30:00Z'),
      location: 'Assemblee Centrale de Yaounde',
      level: 'ASSEMBLY',
      status: 'PUBLISHED',
      authorId: users.pastor.id,
      assemblyId: assemblyYaoundeCentral.id,
      isPublic: true,
    },
  });

  console.log('  Creating comments...');

  await ensureComment({
    content: 'Nous serons presents avec la delegation de Yaounde.',
    targetType: 'ANNOUNCEMENT',
    authorId: users.pastor.id,
    announcementId: nationalAnnouncement.id,
  });

  await ensureComment({
    content: 'Merci pour la planification detaillee.',
    targetType: 'CIRCULAR',
    authorId: users.districtLeader.id,
    circularId: nationalCircular.id,
  });

  await ensureComment({
    content: 'La jeunesse se prepare deja pour cet evenement.',
    targetType: 'EVENT',
    authorId: users.ministryLeader.id,
    eventId: assemblyEvent.id,
  });

  console.log('  Creating notifications...');

  await ensureNotification({
    userId: users.pastor.id,
    title: 'Nouvelle annonce nationale',
    message: nationalAnnouncement.title,
    type: 'ANNOUNCEMENT',
    entityType: 'Announcement',
    entityId: nationalAnnouncement.id,
    data: { level: 'NATIONAL' },
  });

  await ensureNotification({
    userId: users.assemblyAdmin.id,
    title: 'Transfert en attente',
    message: 'Une demande de transfert attend votre suivi.',
    type: 'TRANSFER',
    entityType: 'Transfer',
    entityId: pendingTransfer.id,
    data: { status: pendingTransfer.status },
  });

  await ensureNotification({
    userId: users.regionalLeader.id,
    title: 'Annonce regionale publiee',
    message: regionalAnnouncement.title,
    type: 'ANNOUNCEMENT',
    entityType: 'Announcement',
    entityId: regionalAnnouncement.id,
    data: { level: regionalAnnouncement.level, regionId: regionLittoral.id },
  });

  await ensureNotification({
    userId: users.ministryLeader.id,
    title: 'Annonce ministere publiee',
    message: ministryAnnouncement.title,
    type: 'ANNOUNCEMENT',
    entityType: 'Announcement',
    entityId: ministryAnnouncement.id,
    data: { level: ministryAnnouncement.level, ministryId: youthMinistry.id },
  });

  await ensureNotification({
    userId: users.member.id,
    title: 'Evenement a venir',
    message: assemblyEvent.title,
    type: 'EVENT',
    entityType: 'Event',
    entityId: assemblyEvent.id,
    status: 'READ',
    data: { level: assemblyEvent.level },
  });

  await ensureNotification({
    userId: users.districtLeader.id,
    title: 'Circulaire de district',
    message: districtCircular.title,
    type: 'INFO',
    entityType: 'Circular',
    entityId: districtCircular.id,
    data: { level: districtCircular.level, districtId: districtMfoundi.id },
  });

  await ensureNotification({
    userId: users.nationalAdmin.id,
    title: 'Convention nationale programmee',
    message: nationalEvent.title,
    type: 'EVENT',
    entityType: 'Event',
    entityId: nationalEvent.id,
    data: { level: nationalEvent.level },
  });

  await ensureNotification({
    userId: users.districtLeader.id,
    title: 'Retraite du district programmee',
    message: districtEvent.title,
    type: 'EVENT',
    entityType: 'Event',
    entityId: districtEvent.id,
    data: { level: districtEvent.level, districtId: districtMfoundi.id },
  });

  console.log('  Creating audit logs...');

  await ensureAuditLog({
    actorId: users.superAdmin.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: users.superAdmin.id,
    metadata: { source: 'seed-script' },
  });

  await ensureAuditLog({
    actorId: users.pastor.id,
    action: 'CREATE',
    entityType: 'Announcement',
    entityId: assemblyAnnouncement.id,
    newValues: { title: assemblyAnnouncement.title, level: assemblyAnnouncement.level },
  });

  await ensureAuditLog({
    actorId: users.superAdmin.id,
    action: 'TRANSFER_APPROVE',
    entityType: 'Transfer',
    entityId: approvedTransfer.id,
    newValues: { status: approvedTransfer.status },
  });

  await ensureAuditLog({
    actorId: users.regionalLeader.id,
    action: 'PUBLISH',
    entityType: 'Announcement',
    entityId: regionalAnnouncement.id,
    newValues: { title: regionalAnnouncement.title, level: regionalAnnouncement.level },
  });

  await ensureAuditLog({
    actorId: users.districtLeader.id,
    action: 'PUBLISH',
    entityType: 'Circular',
    entityId: districtCircular.id,
    newValues: { title: districtCircular.title, level: districtCircular.level },
  });

  await ensureAuditLog({
    actorId: users.nationalAdmin.id,
    action: 'PUBLISH',
    entityType: 'Event',
    entityId: nationalEvent.id,
    newValues: { title: nationalEvent.title, level: nationalEvent.level },
  });

  console.log('  Creating conversations and messages...');

  const pastoralConversation = await ensureConversation('Conseil pastoral national', true);
  const localConversation = await ensureConversation('Echanges assemblee centrale', true);
  const directConversation = await ensureConversation('Coordination pastorale', false);

  await ensureConversationParticipant(pastoralConversation.id, users.superAdmin.id, 'admin');
  await ensureConversationParticipant(pastoralConversation.id, users.nationalAdmin.id, 'admin');
  await ensureConversationParticipant(pastoralConversation.id, users.regionalLeader.id, 'member');

  await ensureConversationParticipant(localConversation.id, users.pastor.id, 'admin');
  await ensureConversationParticipant(localConversation.id, users.assemblyAdmin.id, 'admin');
  await ensureConversationParticipant(localConversation.id, users.ministryLeader.id, 'member');

  await ensureConversationParticipant(directConversation.id, users.pastor.id, 'admin');
  await ensureConversationParticipant(directConversation.id, users.districtLeader.id, 'member');

  await ensureMessage(pastoralConversation.id, users.superAdmin.id, 'Bienvenue sur le canal de coordination nationale.');
  await ensureMessage(pastoralConversation.id, users.regionalLeader.id, 'Le Littoral est pret pour la convention.');
  await ensureMessage(localConversation.id, users.pastor.id, 'Merci de preparer les responsables pour dimanche.');
  await ensureMessage(localConversation.id, users.assemblyAdmin.id, 'La liste des volontaires sera partagee ce soir.');
  await ensureMessage(directConversation.id, users.districtLeader.id, 'Pouvons-nous confirmer la date de la retraite ?');

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUPS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  Creating groups...');

  const cellGroup1 = await prisma.groups.upsert({
    where: { name_assemblyId: { name: 'Cellule Biyem-Assi', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      updatedAt: new Date(),
      name: 'Cellule Biyem-Assi',
      assemblyId: assemblyYaoundeCentral.id,
      type: 'CELL_GROUP',
      meetingDay: 'FRIDAY',
      meetingTime: '18:30',
      location: 'Rue de la paix, Biyem-Assi',
      status: 'ACTIVE',
    },
  });

  const cellGroup2 = await prisma.groups.upsert({
    where: { name_assemblyId: { name: 'Cellule Bastos', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      updatedAt: new Date(),
      name: 'Cellule Bastos',
      assemblyId: assemblyYaoundeCentral.id,
      type: 'CELL_GROUP',
      meetingDay: 'WEDNESDAY',
      meetingTime: '19:00',
      location: 'Avenue des Ambassades, Bastos',
      status: 'ACTIVE',
    },
  });

  const bibleStudyGroup = await prisma.groups.upsert({
    where: { name_assemblyId: { name: 'Étude Biblique Centrale', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      updatedAt: new Date(),
      name: 'Étude Biblique Centrale',
      assemblyId: assemblyYaoundeCentral.id,
      type: 'BIBLE_STUDY',
      meetingDay: 'TUESDAY',
      meetingTime: '18:00',
      location: 'Salle de culte principale',
      status: 'ACTIVE',
    },
  });

  const prayerCell = await prisma.groups.upsert({
    where: { name_assemblyId: { name: 'Cellule de Prière Bonaberi', assemblyId: assemblyDoualaBonaberi.id } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      updatedAt: new Date(),
      name: 'Cellule de Prière Bonaberi',
      assemblyId: assemblyDoualaBonaberi.id,
      type: 'PRAYER_CELL',
      meetingDay: 'SATURDAY',
      meetingTime: '07:00',
      location: 'Domicile frère Marcel',
      status: 'ACTIVE',
    },
  });

  // Membres dans les groupes
  const groupMemberships = [
    { groupId: cellGroup1.id, memberId: members.choirLeader.id, role: 'leader' },
    { groupId: cellGroup1.id, memberId: members.youthLeader.id, role: 'member' },
    { groupId: cellGroup1.id, memberId: members.ministryLeaderMember.id, role: 'member' },
    { groupId: cellGroup2.id, memberId: members.ministryLeaderMember.id, role: 'leader' },
    { groupId: cellGroup2.id, memberId: members.districtLeaderMember.id, role: 'member' },
    { groupId: bibleStudyGroup.id, memberId: members.youthLeader.id, role: 'leader' },
    { groupId: bibleStudyGroup.id, memberId: members.choirLeader.id, role: 'assistant' },
    { groupId: prayerCell.id, memberId: members.regionalLeaderMember.id, role: 'leader' },
  ];

  for (const gm of groupMemberships) {
    await prisma.group_members.upsert({
      where: { groupId_memberId: { groupId: gm.groupId, memberId: gm.memberId } },
      update: { role: gm.role, status: 'ACTIVE', updatedAt: new Date() },
      create: { id: crypto.randomUUID(), updatedAt: new Date(), ...gm, status: 'ACTIVE' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROGRAMS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  Creating programs...');

  const sundayService = await prisma.programs.upsert({
    where: { id: 'prog-sunday-central' },
    update: {},
    create: {
      id: 'prog-sunday-central',
      updatedAt: new Date(),
      name: 'Culte du Dimanche',
      assemblyId: assemblyYaoundeCentral.id,
      ministryId: choirMinistry.id,
      frequency: 'WEEKLY',
      dayOfWeek: 'SUNDAY',
      startTime: '09:00',
      endTime: '12:00',
      location: 'Salle de culte principale',
      status: 'ACTIVE',
    },
  });

  const wednesdayPrayer = await prisma.programs.upsert({
    where: { id: 'prog-prayer-central' },
    update: {},
    create: {
      id: 'prog-prayer-central',
      updatedAt: new Date(),
      name: 'Prière du Mercredi',
      assemblyId: assemblyYaoundeCentral.id,
      frequency: 'WEEKLY',
      dayOfWeek: 'WEDNESDAY',
      startTime: '18:00',
      endTime: '20:00',
      location: 'Chapelle de prière',
      status: 'ACTIVE',
    },
  });

  await prisma.programs.upsert({
    where: { id: 'prog-youth-central' },
    update: {},
    create: {
      id: 'prog-youth-central',
      updatedAt: new Date(),
      name: 'Réunion des Jeunes',
      assemblyId: assemblyYaoundeCentral.id,
      ministryId: youthMinistry.id,
      frequency: 'WEEKLY',
      dayOfWeek: 'SATURDAY',
      startTime: '15:00',
      endTime: '18:00',
      location: 'Salle polyvalente',
      status: 'ACTIVE',
    },
  });

  await prisma.programs.upsert({
    where: { id: 'prog-sunday-bonaberi' },
    update: {},
    create: {
      id: 'prog-sunday-bonaberi',
      updatedAt: new Date(),
      name: 'Culte du Dimanche',
      assemblyId: assemblyDoualaBonaberi.id,
      frequency: 'WEEKLY',
      dayOfWeek: 'SUNDAY',
      startTime: '09:30',
      endTime: '12:30',
      location: 'Temple de Bonaberi',
      status: 'ACTIVE',
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE PLANNING
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  Creating service plans...');

  const nextSunday = new Date();
  nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()) % 7 || 7);
  nextSunday.setHours(9, 0, 0, 0);

  const lastSunday = new Date(nextSunday);
  lastSunday.setDate(lastSunday.getDate() - 7);

  const servicePlan1 = await prisma.service_plans.upsert({
    where: { id: 'sp-next-sunday' },
    update: {},
    create: {
      id: 'sp-next-sunday',
      updatedAt: new Date(),
      title: `Culte du ${nextSunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`,
      assemblyId: assemblyYaoundeCentral.id,
      programId: sundayService.id,
      date: nextSunday,
      startTime: '09:00',
      endTime: '12:00',
      location: 'Salle de culte principale',
      status: 'PUBLISHED',
      createdById: users.assemblyAdmin.id,
    },
  });

  await prisma.service_plans.upsert({
    where: { id: 'sp-last-sunday' },
    update: {},
    create: {
      id: 'sp-last-sunday',
      updatedAt: new Date(),
      title: `Culte du ${lastSunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`,
      assemblyId: assemblyYaoundeCentral.id,
      programId: sundayService.id,
      date: lastSunday,
      startTime: '09:00',
      endTime: '12:00',
      location: 'Salle de culte principale',
      status: 'ARCHIVED',
      createdById: users.assemblyAdmin.id,
    },
  });

  const draftPlan = await prisma.service_plans.upsert({
    where: { id: 'sp-prayer-next' },
    update: {},
    create: {
      id: 'sp-prayer-next',
      updatedAt: new Date(),
      title: 'Prière du Mercredi prochain',
      assemblyId: assemblyYaoundeCentral.id,
      programId: wednesdayPrayer.id,
      date: new Date(nextSunday.getTime() - 3 * 24 * 60 * 60 * 1000),
      startTime: '18:00',
      endTime: '20:00',
      location: 'Chapelle de prière',
      status: 'DRAFT',
      createdById: users.assemblyAdmin.id,
    },
  });

  // Affectations
  const serviceAssignments = [
    { servicePlanId: servicePlan1.id, userId: users.pastor.id, role: 'Prédicateur', status: 'CONFIRMED' as const },
    { servicePlanId: servicePlan1.id, userId: users.assemblyAdmin.id, role: 'Modérateur', status: 'CONFIRMED' as const },
    { servicePlanId: servicePlan1.id, userId: users.ministryLeader.id, role: 'Conducteur de louange', status: 'PENDING' as const },
    { servicePlanId: draftPlan.id, userId: users.pastor.id, role: 'Intercesseur', status: 'PENDING' as const },
  ];

  for (const sa of serviceAssignments) {
    await prisma.service_assignments.upsert({
      where: { servicePlanId_userId_role: { servicePlanId: sa.servicePlanId, userId: sa.userId, role: sa.role } },
      update: { status: sa.status, updatedAt: new Date() },
      create: { id: crypto.randomUUID(), updatedAt: new Date(), ...sa },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  Creating attendance records...');

  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  lastWeek.setHours(0, 0, 0, 0);

  const twoWeeksAgo = new Date(lastWeek);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

  const attendanceRecords = [
    // Session cellule la semaine dernière
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.choirLeader.id, isPresent: true, sessionDate: lastWeek },
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.youthLeader.id, isPresent: true, sessionDate: lastWeek },
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.ministryLeaderMember.id, isPresent: false, sessionDate: lastWeek },
    // Session cellule il y a 2 semaines
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.choirLeader.id, isPresent: true, sessionDate: twoWeeksAgo },
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.youthLeader.id, isPresent: false, sessionDate: twoWeeksAgo },
    { entityType: 'GROUP' as const, entityId: cellGroup1.id, memberId: members.ministryLeaderMember.id, isPresent: true, sessionDate: twoWeeksAgo },
    // Étude biblique
    { entityType: 'GROUP' as const, entityId: bibleStudyGroup.id, memberId: members.youthLeader.id, isPresent: true, sessionDate: lastWeek },
    { entityType: 'GROUP' as const, entityId: bibleStudyGroup.id, memberId: members.choirLeader.id, isPresent: true, sessionDate: lastWeek },
  ];

  for (const rec of attendanceRecords) {
    await prisma.attendances.create({
      data: { id: crypto.randomUUID(), ...rec, takenById: users.assemblyAdmin.id },
    }).catch(() => { /* ignorer les doublons */ });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOP — PRODUITS ET COMMANDES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('  Creating shop products and orders...');

  const bible = await prisma.product.upsert({
    where: { id: 'prod-bible-tob' },
    update: {},
    create: {
      id: 'prod-bible-tob',
      title: 'Bible TOB — Traduction Œcuménique',
      type: 'BOOK',
      price: 12000,
      currency: 'XAF',
      stock: 25,
      status: 'AVAILABLE',
      description: 'Bible avec introductions et notes, format compact.',
      assemblyId: assemblyYaoundeCentral.id,
    },
  });

  const devotional = await prisma.product.upsert({
    where: { id: 'prod-devo-2024' },
    update: {},
    create: {
      id: 'prod-devo-2024',
      title: 'Méditations Quotidiennes 2024',
      type: 'BOOK',
      price: 5000,
      currency: 'XAF',
      stock: 40,
      status: 'AVAILABLE',
      description: 'Un an de méditations pour grandir spirituellement.',
      assemblyId: assemblyYaoundeCentral.id,
    },
  });

  await prisma.product.upsert({
    where: { id: 'prod-hymnal-mpe' },
    update: {},
    create: {
      id: 'prod-hymnal-mpe',
      title: 'Recueil de Cantiques MPE',
      type: 'HYMNAL',
      price: 4000,
      currency: 'XAF',
      stock: 30,
      status: 'AVAILABLE',
      description: 'Recueil officiel des cantiques de la Mission.',
      assemblyId: assemblyYaoundeCentral.id,
    },
  });

  await prisma.product.upsert({
    where: { id: 'prod-audio-chorale' },
    update: {},
    create: {
      id: 'prod-audio-chorale',
      title: 'Chorale Bethel — Louange & Adoration (Audio)',
      type: 'AUDIO',
      price: 3000,
      currency: 'XAF',
      stock: 15,
      status: 'AVAILABLE',
      description: 'Enregistrement live du concert de louange 2023.',
      assemblyId: assemblyYaoundeCentral.id,
    },
  });

  // Commandes
  await prisma.shopOrder.upsert({
    where: { id: 'order-member-1' },
    update: {},
    create: {
      id: 'order-member-1',
      reference: 'ORD-MBR1-2024',
      userId: users.member.id,
      assemblyId: assemblyYaoundeCentral.id,
      total: 17000,
      currency: 'XAF',
      deliveryMethod: 'PICKUP',
      status: 'DELIVERED',
      items: {
        create: [
          { productId: bible.id, quantity: 1, unitPrice: 12000 },
          { productId: devotional.id, quantity: 1, unitPrice: 5000 },
        ],
      },
    },
  });

  await prisma.shopOrder.upsert({
    where: { id: 'order-admin-1' },
    update: {},
    create: {
      id: 'order-admin-1',
      reference: 'ORD-ADM1-2024',
      userId: users.assemblyAdmin.id,
      assemblyId: assemblyYaoundeCentral.id,
      total: 24000,
      currency: 'XAF',
      deliveryMethod: 'PICKUP',
      status: 'PENDING',
      items: {
        create: [
          { productId: bible.id, quantity: 2, unitPrice: 12000 },
        ],
      },
    },
  });

  // ─── Consolidation Module Seeds ──────────────────────────────────────────────
  console.log('  Seeding consolidation module...');

  const familyAlpha = await prisma.familyOfDisciples.upsert({
    where: { name_assemblyId: { name: 'Famille Alpha', assemblyId: assemblyYaoundeCentral.id } },
    update: {},
    create: {
      tenantId: defaultTenant.id,
      assemblyId: assemblyYaoundeCentral.id,
      name: 'Famille Alpha',
      description: 'Première famille de disciples — zone centre-ville',
      status: 'ACTIVE',
      leaderId: members.pastorCentre.id,
      goal: 12,
    },
  });

  const maker1 = await prisma.discipleMakerProfile.upsert({
    where: { memberId: members.pastorCentre.id },
    update: {},
    create: {
      tenantId: defaultTenant.id,
      memberId: members.pastorCentre.id,
      familyId: familyAlpha.id,
      maxLoad: 8,
      isActive: true,
    },
  });

  const maker2 = await prisma.discipleMakerProfile.upsert({
    where: { memberId: members.ministryLeaderMember.id },
    update: {},
    create: {
      tenantId: defaultTenant.id,
      memberId: members.ministryLeaderMember.id,
      familyId: familyAlpha.id,
      partnerId: members.pastorCentre.id,
      maxLoad: 8,
      isActive: true,
    },
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000001',
      firstName: 'Marie', lastName: 'BIYONG', gender: 'FEMALE',
      phone: '+237 690 111 001', assemblyId: assemblyYaoundeCentral.id,
      status: 'NEW', soulType: 'NA', riskScore: 0,
      firstVisitDate: daysAgo(2),
    },
  });

  await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000002',
      firstName: 'Paul', lastName: 'NDONGO', gender: 'MALE',
      phone: '+237 690 111 002', assemblyId: assemblyYaoundeCentral.id,
      status: 'NEW', soulType: 'NC', riskScore: 0,
      firstVisitDate: daysAgo(1),
    },
  });

  const soul3 = await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000003',
      firstName: 'Sarah', lastName: 'MENGUE', gender: 'FEMALE',
      phone: '+237 690 111 003', assemblyId: assemblyYaoundeCentral.id,
      status: 'ASSIGNED', soulType: 'NA',
      primaryMakerProfileId: maker1.id, riskScore: 15,
      lastContactDate: daysAgo(3),
      firstVisitDate: daysAgo(10),
    },
  });

  const soul4 = await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000004' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000004',
      firstName: 'Jean', lastName: 'ABEGA', gender: 'MALE',
      phone: '+237 690 111 004', assemblyId: assemblyYaoundeCentral.id,
      status: 'IN_FD', soulType: 'NA',
      familyOfDisciplesId: familyAlpha.id,
      primaryMakerProfileId: maker1.id,
      riskScore: 5, lastContactDate: daysAgo(1), lastCulteDate: daysAgo(4),
      firstVisitDate: daysAgo(20),
    },
  });

  const soul5 = await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000005' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000005',
      firstName: 'Amina', lastName: 'FOUDA', gender: 'FEMALE',
      phone: '+237 690 111 005', assemblyId: assemblyYaoundeCentral.id,
      status: 'IN_FD', soulType: 'NA',
      familyOfDisciplesId: familyAlpha.id,
      primaryMakerProfileId: maker2.id,
      riskScore: 10, lastContactDate: daysAgo(2), lastCulteDate: daysAgo(4),
      firstVisitDate: daysAgo(18),
    },
  });

  await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000006' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000006',
      firstName: 'Christiane', lastName: 'ONDO', gender: 'FEMALE',
      phone: '+237 690 111 006', assemblyId: assemblyYaoundeCentral.id,
      status: 'CONSOLIDATED', soulType: 'NA',
      familyOfDisciplesId: familyAlpha.id,
      primaryMakerProfileId: maker1.id,
      riskScore: 0, lastContactDate: daysAgo(1), lastCulteDate: daysAgo(4),
      firstVisitDate: daysAgo(60),
    },
  });

  const soul7 = await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000007' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000007',
      firstName: 'Roger', lastName: 'NKOMO', gender: 'MALE',
      phone: '+237 690 111 007', assemblyId: assemblyYaoundeCentral.id,
      status: 'AT_RISK', soulType: 'NA',
      familyOfDisciplesId: familyAlpha.id,
      primaryMakerProfileId: maker2.id,
      riskScore: 55, consecutiveAbsences: 3,
      lastContactDate: daysAgo(12), lastCulteDate: daysAgo(18),
      firstVisitDate: daysAgo(35),
    },
  });

  const soul8 = await prisma.newVisitor.upsert({
    where: { id: '00000000-0001-0000-0000-000000000008' },
    update: {},
    create: {
      id: '00000000-0001-0000-0000-000000000008',
      firstName: 'Blaise', lastName: 'ESSAMA', gender: 'MALE',
      phone: '+237 690 111 008', assemblyId: assemblyYaoundeCentral.id,
      status: 'TASK_FORCE', soulType: 'NA',
      familyOfDisciplesId: familyAlpha.id,
      riskScore: 80, consecutiveAbsences: 4,
      lastContactDate: daysAgo(28), lastCulteDate: daysAgo(30),
      firstVisitDate: daysAgo(45),
    },
  });

  // Présences culte
  const soulCulteDates = [daysAgo(4), daysAgo(11), daysAgo(18)];
  for (const culteDate of soulCulteDates) {
    await prisma.soulCulteAttendance.upsert({
      where: { soulId_culteDate: { soulId: soul4.id, culteDate } },
      update: {},
      create: { soulId: soul4.id, culteDate, status: 'PRESENT', recordedById: users.pastor.id },
    });
    await prisma.soulCulteAttendance.upsert({
      where: { soulId_culteDate: { soulId: soul5.id, culteDate } },
      update: {},
      create: { soulId: soul5.id, culteDate, status: 'PRESENT', recordedById: users.pastor.id },
    });
  }
  // Absence de l'âme AT_RISK
  for (const culteDate of soulCulteDates) {
    await prisma.soulCulteAttendance.upsert({
      where: { soulId_culteDate: { soulId: soul7.id, culteDate } },
      update: {},
      create: { soulId: soul7.id, culteDate, status: 'ABSENT', absenceReason: 'UNREACHABLE', recordedById: users.pastor.id },
    });
  }

  // Cas Task Force
  await prisma.recoveryCase.upsert({
    where: { id: '00000000-cafe-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-cafe-0000-0000-000000000001',
      soulId: soul8.id,
      tenantId: defaultTenant.id,
      reason: 'Absent depuis plus de 4 semaines, injoignable par téléphone',
      openedById: users.pastor.id,
      assignedToId: users.ministryLeader.id,
      status: 'OPEN',
    },
  });

  // Tâches de suivi
  await prisma.followUpTask.upsert({
    where: { id: '00000000-task-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-task-0000-0000-000000000001',
      tenantId: defaultTenant.id,
      soulId: soul7.id,
      assignedToId: users.ministryLeader.id,
      createdById: users.pastor.id,
      type: 'CALL',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'PENDING',
      notes: 'Appeler Roger pour comprendre ses absences répétées',
    },
  });

  await prisma.followUpTask.upsert({
    where: { id: '00000000-task-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-task-0000-0000-000000000002',
      tenantId: defaultTenant.id,
      soulId: soul3.id,
      assignedToId: users.pastor.id,
      createdById: users.pastor.id,
      type: 'VISIT',
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      status: 'PENDING',
      notes: 'Première visite à domicile pour Sarah',
    },
  });

  console.log('Seed completed successfully.');
  console.log('Credentials:');
  console.log('  Super Admin:      admin@mpe-cameroun.org / Admin@2024!');
  console.log('  National Admin:   national.admin@mpe-cameroun.org / National@2024!');
  console.log('  Regional Leader:  rachel.ewane@mpe-cameroun.org / Regional@2024!');
  console.log('  District Leader:  joseph.minko@mpe-cameroun.org / District@2024!');
  console.log('  Pastor:           pastor.nkomo@mpe-cameroun.org / Pastor@2024!');
  console.log('  Assembly Admin:   assembly.admin@mpe-cameroun.org / Assembly@2024!');
  console.log('  Ministry Leader:  ministry.leader@mpe-cameroun.org / Ministry@2024!');
  console.log('  Member:           member.denis@mpe-cameroun.org / Member@2024!');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
