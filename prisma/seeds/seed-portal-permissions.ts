import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PORTAL_PERMISSIONS = [
  { name: 'public_campaigns:create',   displayName: 'Portail – Créer campagnes',     module: 'public_portal', action: 'create'   },
  { name: 'public_campaigns:read',     displayName: 'Portail – Voir campagnes',       module: 'public_portal', action: 'read'     },
  { name: 'public_campaigns:update',   displayName: 'Portail – Modifier campagnes',   module: 'public_portal', action: 'update'   },
  { name: 'public_campaigns:activate', displayName: 'Portail – Activer campagnes',    module: 'public_portal', action: 'activate' },
  { name: 'public_campaigns:delete',   displayName: 'Portail – Archiver campagnes',   module: 'public_portal', action: 'delete'   },
  { name: 'public_links:create',       displayName: 'Portail – Créer liens',          module: 'public_portal', action: 'create'   },
  { name: 'public_links:read',         displayName: 'Portail – Voir liens',           module: 'public_portal', action: 'read'     },
  { name: 'public_qr_codes:generate',  displayName: 'Portail – Générer QR Codes',     module: 'public_portal', action: 'generate' },
  { name: 'public_submissions:read',   displayName: 'Portail – Voir soumissions',     module: 'public_portal', action: 'read'     },
  { name: 'public_submissions:export', displayName: 'Portail – Exporter soumissions', module: 'public_portal', action: 'export'   },
  { name: 'public_forms:manage',       displayName: 'Portail – Gérer formulaires',    module: 'public_portal', action: 'manage'   },
  { name: 'public_analytics:read',     displayName: 'Portail – Voir analytics',       module: 'public_portal', action: 'read'     },
  { name: 'public_settings:manage',    displayName: 'Portail – Gérer paramètres',     module: 'public_portal', action: 'manage'   },
];

const ADMIN_ROLES = ['super_admin', 'tenant_owner', 'tenant_admin', 'national_admin', 'assembly_pastor', 'assembly_admin'];
const READ_ROLES  = ['regional_leader', 'district_leader'];

async function main() {
  // Créer/mettre à jour les permissions
  const created: string[] = [];
  for (const perm of PORTAL_PERMISSIONS) {
    const existing = await prisma.permission.findFirst({ where: { name: perm.name } });
    if (!existing) {
      await prisma.permission.create({
        data: { name: perm.name, displayName: perm.displayName, module: perm.module, action: perm.action },
      });
      created.push(perm.name);
    }
  }
  console.log(`✓ ${created.length} permissions créées:`, created);

  // Assigner aux rôles admin (toutes les permissions)
  for (const roleName of ADMIN_ROLES) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) continue;
    for (const perm of PORTAL_PERMISSIONS) {
      const permission = await prisma.permission.findFirst({ where: { name: perm.name } });
      if (!permission) continue;
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: permission.id },
      });
      if (!exists) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
    }
    console.log(`✓ Permissions portail assignées à ${roleName}`);
  }

  // Rôles régionaux/district : lecture seulement
  const readPerms = PORTAL_PERMISSIONS.filter(p => p.name.includes(':read') || p.name.includes(':generate'));
  for (const roleName of READ_ROLES) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) continue;
    for (const perm of readPerms) {
      const permission = await prisma.permission.findFirst({ where: { name: perm.name } });
      if (!permission) continue;
      const exists = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: permission.id },
      });
      if (!exists) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
    }
    console.log(`✓ Permissions lecture portail assignées à ${roleName}`);
  }

  console.log('\n✅ Seeds portail public terminés');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
