-- Rattrapage production: permissions Live, Portail public et Consolidation.
-- Cette migration est non destructive et idempotente:
-- - cree ou met a jour les permissions manquantes;
-- - donne toutes les permissions aux roles globaux/tenant;
-- - donne les permissions operationnelles Live/Portail/Consolidation aux responsables d'assemblee;
-- - donne les lectures utiles aux responsables region/district.

WITH permission_rows("name", "displayName", "module", "action") AS (
  VALUES
    -- Live & medias
    ('live_channels:create',  'Live - Creer sources',      'live', 'create'),
    ('live_channels:read',    'Live - Voir sources',       'live', 'read'),
    ('live_channels:update',  'Live - Modifier sources',   'live', 'update'),
    ('live_channels:delete',  'Live - Supprimer sources',  'live', 'delete'),
    ('live_services:create',  'Live - Creer services',     'live', 'create'),
    ('live_services:read',    'Live - Voir services',      'live', 'read'),
    ('live_services:update',  'Live - Modifier services',  'live', 'update'),
    ('live_services:publish', 'Live - Publier services',   'live', 'publish'),
    ('live_services:delete',  'Live - Supprimer services', 'live', 'delete'),
    ('live_hosts:manage',     'Live - Gerer hotes',        'live', 'manage'),
    ('live_chat:moderate',    'Live - Moderer chat',       'live', 'moderate'),
    ('live_moments:manage',   'Live - Gerer moments',      'live', 'manage'),
    ('live_prayer:manage',    'Live - Gerer prieres',      'live', 'manage'),
    ('live_replays:manage',   'Live - Gerer replays',      'live', 'manage'),
    ('live_analytics:read',   'Live - Voir analytics',     'live', 'read'),
    ('live_settings:manage',  'Live - Parametres',         'live', 'manage'),

    -- Portail public / QR Codes / campagnes
    ('public_campaigns:create',   'Portail - Creer campagnes',     'public_portal', 'create'),
    ('public_campaigns:read',     'Portail - Voir campagnes',      'public_portal', 'read'),
    ('public_campaigns:update',   'Portail - Modifier campagnes',  'public_portal', 'update'),
    ('public_campaigns:activate', 'Portail - Activer campagnes',   'public_portal', 'activate'),
    ('public_campaigns:delete',   'Portail - Archiver campagnes',  'public_portal', 'delete'),
    ('public_links:create',       'Portail - Creer liens',         'public_portal', 'create'),
    ('public_links:read',         'Portail - Voir liens',          'public_portal', 'read'),
    ('public_qr_codes:generate',  'Portail - Generer QR Codes',    'public_portal', 'generate'),
    ('public_submissions:read',   'Portail - Voir soumissions',    'public_portal', 'read'),
    ('public_submissions:export', 'Portail - Exporter soumissions','public_portal', 'export'),
    ('public_forms:manage',       'Portail - Gerer formulaires',   'public_portal', 'manage'),
    ('public_analytics:read',     'Portail - Voir analytics',      'public_portal', 'read'),
    ('public_settings:manage',    'Portail - Gerer parametres',    'public_portal', 'manage'),

    -- Consolidation / suivi des ames
    ('souls:read',                         'Consolidation - Voir ames',                 'consolidation', 'read'),
    ('souls:write',                        'Consolidation - Modifier ames',             'consolidation', 'write'),
    ('souls:assign',                       'Consolidation - Assigner ames',             'consolidation', 'assign'),
    ('souls:archive',                      'Consolidation - Archiver ames',             'consolidation', 'archive'),
    ('fd:read',                            'FD - Voir familles',                        'consolidation', 'read'),
    ('fd:write',                           'FD - Modifier familles',                    'consolidation', 'write'),
    ('fd:manage',                          'FD - Gerer familles',                       'consolidation', 'manage'),
    ('disciple_makers:manage',             'Consolidation - Gerer faiseurs',            'consolidation', 'manage'),
    ('followups:read',                     'Consolidation - Voir suivis',               'consolidation', 'read'),
    ('followups:write',                    'Consolidation - Modifier suivis',           'consolidation', 'write'),
    ('soul_attendance:manage',             'Consolidation - Gerer presences',           'consolidation', 'manage'),
    ('consolidation_journeys:manage',      'Consolidation - Gerer parcours',            'consolidation', 'manage'),
    ('task_force:manage',                  'Consolidation - Gerer task force',          'consolidation', 'manage'),
    ('consolidation_reports:read',         'Consolidation - Voir rapports',             'consolidation', 'read'),
    ('consolidation_settings:manage',      'Consolidation - Gerer parametres',          'consolidation', 'manage')
)
INSERT INTO "permissions" ("id", "name", "displayName", "module", "action", "createdAt")
SELECT
  concat(
    substr(md5('permission:' || pr."name"), 1, 8), '-',
    substr(md5('permission:' || pr."name"), 9, 4), '-',
    substr(md5('permission:' || pr."name"), 13, 4), '-',
    substr(md5('permission:' || pr."name"), 17, 4), '-',
    substr(md5('permission:' || pr."name"), 21, 12)
  ),
  pr."name",
  pr."displayName",
  pr."module",
  pr."action",
  CURRENT_TIMESTAMP
FROM permission_rows pr
ON CONFLICT ("name") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action";

-- Un createur de tenant / responsable tenant doit avoir toutes les permissions
-- existantes, le tenantId des user_roles et les filtres de service gardant
-- l'isolation multi-tenant.
INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5('tenant-all:' || r."id" || ':' || p."id"), 1, 8), '-',
    substr(md5('tenant-all:' || r."id" || ':' || p."id"), 9, 4), '-',
    substr(md5('tenant-all:' || r."id" || ':' || p."id"), 13, 4), '-',
    substr(md5('tenant-all:' || r."id" || ':' || p."id"), 17, 4), '-',
    substr(md5('tenant-all:' || r."id" || ':' || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" IN ('super_admin', 'tenant_owner', 'tenant_admin', 'national_admin')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Responsables d'assemblee: acces operationnel dans leur scope.
INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5('assembly-ops:' || r."id" || ':' || p."id"), 1, 8), '-',
    substr(md5('assembly-ops:' || r."id" || ':' || p."id"), 9, 4), '-',
    substr(md5('assembly-ops:' || r."id" || ':' || p."id"), 13, 4), '-',
    substr(md5('assembly-ops:' || r."id" || ':' || p."id"), 17, 4), '-',
    substr(md5('assembly-ops:' || r."id" || ':' || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
JOIN "permissions" p
  ON p."module" IN ('live', 'public_portal', 'consolidation')
WHERE r."name" IN ('assembly_pastor', 'assembly_admin')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Responsables region/district: lecture et generation QR, sans mutation globale.
INSERT INTO "role_permissions" ("id", "roleId", "permissionId")
SELECT
  concat(
    substr(md5('territory-read:' || r."id" || ':' || p."id"), 1, 8), '-',
    substr(md5('territory-read:' || r."id" || ':' || p."id"), 9, 4), '-',
    substr(md5('territory-read:' || r."id" || ':' || p."id"), 13, 4), '-',
    substr(md5('territory-read:' || r."id" || ':' || p."id"), 17, 4), '-',
    substr(md5('territory-read:' || r."id" || ':' || p."id"), 21, 12)
  ),
  r."id",
  p."id"
FROM "roles" r
JOIN "permissions" p
  ON p."name" IN (
    'live_channels:read',
    'live_services:read',
    'live_analytics:read',
    'public_campaigns:read',
    'public_links:read',
    'public_qr_codes:generate',
    'public_submissions:read',
    'public_analytics:read',
    'souls:read',
    'fd:read',
    'followups:read',
    'consolidation_reports:read'
  )
WHERE r."name" IN ('regional_leader', 'district_leader')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
