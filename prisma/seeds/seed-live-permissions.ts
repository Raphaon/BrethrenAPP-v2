import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LIVE_PERMISSIONS = [
  { name: 'live_channels:create',  displayName: 'Live – Créer sources',     module: 'live', action: 'create'   },
  { name: 'live_channels:read',    displayName: 'Live – Voir sources',       module: 'live', action: 'read'     },
  { name: 'live_channels:update',  displayName: 'Live – Modifier sources',   module: 'live', action: 'update'   },
  { name: 'live_channels:delete',  displayName: 'Live – Supprimer sources',  module: 'live', action: 'delete'   },
  { name: 'live_services:create',  displayName: 'Live – Créer services',     module: 'live', action: 'create'   },
  { name: 'live_services:read',    displayName: 'Live – Voir services',      module: 'live', action: 'read'     },
  { name: 'live_services:update',  displayName: 'Live – Modifier services',  module: 'live', action: 'update'   },
  { name: 'live_services:publish', displayName: 'Live – Publier services',   module: 'live', action: 'publish'  },
  { name: 'live_services:delete',  displayName: 'Live – Supprimer services', module: 'live', action: 'delete'   },
  { name: 'live_hosts:manage',     displayName: 'Live – Gérer hôtes',        module: 'live', action: 'manage'   },
  { name: 'live_chat:moderate',    displayName: 'Live – Modérer chat',       module: 'live', action: 'moderate' },
  { name: 'live_moments:manage',   displayName: 'Live – Gérer moments',      module: 'live', action: 'manage'   },
  { name: 'live_prayer:manage',    displayName: 'Live – Gérer prières',      module: 'live', action: 'manage'   },
  { name: 'live_replays:manage',   displayName: 'Live – Gérer replays',      module: 'live', action: 'manage'   },
  { name: 'live_analytics:read',   displayName: 'Live – Voir analytics',     module: 'live', action: 'read'     },
  { name: 'live_settings:manage',  displayName: 'Live – Paramètres',         module: 'live', action: 'manage'   },
];

const ADMIN_ROLES  = ['super_admin', 'tenant_owner', 'tenant_admin', 'national_admin', 'assembly_pastor', 'assembly_admin'];
const READ_ROLES   = ['regional_leader', 'district_leader'];

async function main() {
  const created: string[] = [];
  for (const perm of LIVE_PERMISSIONS) {
    const exists = await prisma.permission.findFirst({ where: { name: perm.name } });
    if (!exists) {
      await prisma.permission.create({ data: perm });
      created.push(perm.name);
    }
  }
  console.log(`✓ ${created.length} permissions Live créées`);

  for (const roleName of ADMIN_ROLES) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) continue;
    for (const perm of LIVE_PERMISSIONS) {
      const permission = await prisma.permission.findFirst({ where: { name: perm.name } });
      if (!permission) continue;
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: role.id, permissionId: permission.id } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    console.log(`✓ Permissions Live assignées à ${roleName}`);
  }

  const readPerms = LIVE_PERMISSIONS.filter(p => p.action === 'read');
  for (const roleName of READ_ROLES) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) continue;
    for (const perm of readPerms) {
      const permission = await prisma.permission.findFirst({ where: { name: perm.name } });
      if (!permission) continue;
      const exists = await prisma.rolePermission.findFirst({ where: { roleId: role.id, permissionId: permission.id } });
      if (!exists) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    console.log(`✓ Permissions lecture Live assignées à ${roleName}`);
  }

  console.log('\n✅ Seeds Live terminés');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
