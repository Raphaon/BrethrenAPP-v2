import { AnnouncementLevel, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';
import { AppError, ForbiddenError, NotFoundError } from '../middlewares/error.middleware';
import { isSuperAdmin, isTenantWideAdmin } from '../middlewares/rbac.middleware';
import { AuthUser } from '../shared/types/express';

export type ActorScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'region'; tenantId: string; regionId: string }
  | { kind: 'district'; tenantId: string; districtId: string; regionId: string }
  | { kind: 'assembly'; tenantId: string; assemblyId: string; districtId: string; regionId: string }
  | { kind: 'none' };

export async function getActorScope(user: AuthUser): Promise<ActorScope> {
  if (isSuperAdmin(user)) {
    return { kind: 'platform' };
  }

  const tenantId = user.tenantId ?? user.roles.find((role) => role.tenantId)?.tenantId ?? null;

  if (tenantId && isTenantWideAdmin(user)) {
    return { kind: 'tenant', tenantId };
  }

  const assemblyRole = user.roles.find((role) => role.assemblyId);
  if (assemblyRole?.assemblyId) {
    const assembly = await prisma.assembly.findUnique({
      where: { id: assemblyRole.assemblyId, deletedAt: null },
      select: { id: true, districtId: true, district: { select: { regionId: true, region: { select: { tenantId: true } } } } },
    });

    if (!assembly) {
      throw new NotFoundError('Assemblee');
    }

    return {
      kind: 'assembly',
      tenantId: assembly.district.region.tenantId,
      assemblyId: assembly.id,
      districtId: assembly.districtId,
      regionId: assembly.district.regionId,
    };
  }

  const districtRole = user.roles.find((role) => role.districtId);
  if (districtRole?.districtId) {
    const district = await prisma.district.findUnique({
      where: { id: districtRole.districtId, deletedAt: null },
      select: { id: true, regionId: true, region: { select: { tenantId: true } } },
    });

    if (!district) {
      throw new NotFoundError('District');
    }

    return {
      kind: 'district',
      tenantId: district.region.tenantId,
      districtId: district.id,
      regionId: district.regionId,
    };
  }

  const regionRole = user.roles.find((role) => role.regionId);
  if (regionRole?.regionId) {
    const region = await prisma.region.findUnique({
      where: { id: regionRole.regionId, deletedAt: null },
      select: { id: true, tenantId: true },
    });

    if (!region) {
      throw new NotFoundError('Region');
    }

    return {
      kind: 'region',
      tenantId: region.tenantId,
      regionId: region.id,
    };
  }

  return { kind: 'none' };
}

export async function assertRegionAccess(user: AuthUser, regionId: string): Promise<void> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return;
  if (scope.kind === 'tenant') {
    const region = await prisma.region.findUnique({
      where: { id: regionId, deletedAt: null },
      select: { tenantId: true },
    });
    if (!region) throw new NotFoundError('Region');
    if (region.tenantId === scope.tenantId) return;
  }
  if (scope.kind === 'region' && scope.regionId === regionId) return;
  if (scope.kind === 'district' && scope.regionId === regionId) return;
  if (scope.kind === 'assembly' && scope.regionId === regionId) return;

  throw new ForbiddenError('Acces a cette region refuse');
}

export async function assertDistrictAccess(user: AuthUser, districtId: string): Promise<void> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return;
  if (scope.kind === 'tenant') {
    const district = await prisma.district.findUnique({
      where: { id: districtId, deletedAt: null },
      select: { region: { select: { tenantId: true } } },
    });
    if (!district) throw new NotFoundError('District');
    if (district.region.tenantId === scope.tenantId) return;
  }
  if (scope.kind === 'district' && scope.districtId === districtId) return;
  if (scope.kind === 'assembly' && scope.districtId === districtId) return;

  const district = await prisma.district.findUnique({
    where: { id: districtId, deletedAt: null },
    select: { regionId: true },
  });

  if (!district) {
    throw new NotFoundError('District');
  }

  if (scope.kind === 'region' && scope.regionId === district.regionId) return;

  throw new ForbiddenError('Acces a ce district refuse');
}

export async function assertAssemblyAccess(user: AuthUser, assemblyId: string): Promise<void> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return;
  if (scope.kind === 'assembly' && scope.assemblyId === assemblyId) return;

  const assembly = await prisma.assembly.findUnique({
    where: { id: assemblyId, deletedAt: null },
    select: { districtId: true, district: { select: { regionId: true, region: { select: { tenantId: true } } } } },
  });

  if (!assembly) {
    throw new NotFoundError('Assemblee');
  }

  if (scope.kind === 'tenant' && scope.tenantId === assembly.district.region.tenantId) return;
  if (scope.kind === 'district' && scope.districtId === assembly.districtId) return;
  if (scope.kind === 'region' && scope.regionId === assembly.district.regionId) return;

  throw new ForbiddenError('Acces a cette assemblee refuse');
}

export async function getScopedDistrictWhere(user: AuthUser): Promise<Prisma.DistrictWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { region: { tenantId: scope.tenantId } };
    case 'region':
      return { regionId: scope.regionId, region: { tenantId: scope.tenantId } };
    case 'district':
      return { id: scope.districtId };
    case 'assembly':
      return { id: scope.districtId };
    default:
      return { id: 'NONE' };
  }
}

export async function getScopedAssemblyWhere(user: AuthUser): Promise<Prisma.AssemblyWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { district: { region: { tenantId: scope.tenantId } } };
    case 'region':
      return { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } };
    case 'district':
      return { districtId: scope.districtId };
    case 'assembly':
      return { id: scope.assemblyId };
    default:
      return { id: 'NONE' };
  }
}

export async function getScopedPreachingPointWhere(user: AuthUser): Promise<Prisma.PreachingPointWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':
      return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
    case 'district':
      return { assembly: { districtId: scope.districtId } };
    case 'assembly':
      return { assemblyId: scope.assemblyId };
    default:
      return { id: 'NONE' };
  }
}

export async function assertOptionalAssemblyAccess(
  user: AuthUser,
  assemblyId: string | null | undefined,
  entityName = 'Ressource',
): Promise<void> {
  if (assemblyId) {
    await assertAssemblyAccess(user, assemblyId);
    return;
  }

  const scope = await getActorScope(user);
  if (scope.kind === 'platform' || scope.kind === 'tenant') return;

  throw new ForbiddenError(`${entityName} sans assemblee reservee aux administrateurs du tenant`);
}

export async function getScopedLiveServiceWhere(user: AuthUser): Promise<Prisma.LiveServiceWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
      return { tenantId: scope.tenantId, assembly: { district: { regionId: scope.regionId } } };
    case 'district':
      return { tenantId: scope.tenantId, assembly: { districtId: scope.districtId } };
    case 'assembly':
      return { tenantId: scope.tenantId, assemblyId: scope.assemblyId };
    default:
      return { id: 'NONE' };
  }
}

export async function getScopedLiveChannelWhere(user: AuthUser): Promise<Prisma.LiveChannelWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assemblyId: null },
          { assembly: { district: { regionId: scope.regionId } } },
        ],
      };
    case 'district':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assemblyId: null },
          { assembly: { districtId: scope.districtId } },
        ],
      };
    case 'assembly':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assemblyId: null },
          { assemblyId: scope.assemblyId },
        ],
      };
    default:
      return { id: 'NONE' };
  }
}

export async function getScopedMediaReplayWhere(user: AuthUser): Promise<Prisma.MediaReplayWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assembly: { district: { regionId: scope.regionId } } },
          { service: { assembly: { district: { regionId: scope.regionId } } } },
        ],
      };
    case 'district':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assembly: { districtId: scope.districtId } },
          { service: { assembly: { districtId: scope.districtId } } },
        ],
      };
    case 'assembly':
      return {
        tenantId: scope.tenantId,
        OR: [
          { assemblyId: scope.assemblyId },
          { service: { assemblyId: scope.assemblyId } },
        ],
      };
    default:
      return { id: 'NONE' };
  }
}

export async function getScopedUserWhere(user: AuthUser): Promise<Prisma.UserWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { tenantId: scope.tenantId };
    case 'region':
      return {
        tenantId: scope.tenantId,
        OR: [
          { member: { assembly: { district: { regionId: scope.regionId } } } },
          { userRoles: { some: { regionId: scope.regionId } } },
          { userRoles: { some: { district: { regionId: scope.regionId } } } },
          { userRoles: { some: { assembly: { district: { regionId: scope.regionId } } } } },
        ],
      };
    case 'district':
      return {
        tenantId: scope.tenantId,
        OR: [
          { member: { assembly: { districtId: scope.districtId } } },
          { userRoles: { some: { districtId: scope.districtId } } },
          { userRoles: { some: { assembly: { districtId: scope.districtId } } } },
        ],
      };
    case 'assembly':
      return {
        tenantId: scope.tenantId,
        OR: [
          { member: { assemblyId: scope.assemblyId } },
          { userRoles: { some: { assemblyId: scope.assemblyId } } },
        ],
      };
    default:
      return { id: 'NONE' };
  }
}

export async function assertManageableUser(user: AuthUser, targetUserId: string): Promise<void> {
  const where = await getScopedUserWhere(user);

  if (isSuperAdmin(user)) return;

  const target = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      deletedAt: null,
      ...where,
    },
    select: { id: true },
  });

  if (!target) {
    throw new ForbiddenError('Acces a cet utilisateur refuse');
  }
}

export async function assertManageableMember(user: AuthUser, memberId: string): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { id: memberId, deletedAt: null },
    select: { assemblyId: true },
  });

  if (!member) {
    throw new NotFoundError('Membre');
  }

  await assertAssemblyAccess(user, member.assemblyId);
}

export async function assertAssignableRole(
  actor: AuthUser,
  roleName: string,
  scope: {
    regionId?: string | null;
    districtId?: string | null;
    assemblyId?: string | null;
    ministryId?: string | null;
  },
): Promise<void> {
  const actorScope = await getActorScope(actor);

  if (actorScope.kind === 'platform') {
    return;
  }

  if (actorScope.kind === 'tenant') {
    // Super-admin est un rôle de niveau plateforme — seul un super_admin peut l'attribuer.
    // Cela empêche toute élévation de privilège vers le niveau plateforme.
    if (roleName === 'super_admin') {
      throw new ForbiddenError("Seul un Super Administrateur de la plateforme peut attribuer ce role");
    }

    // Les rôles de niveau organisation (tenant_owner, tenant_admin, national_admin)
    // ne peuvent être attribués que par un tenant_owner — pas par un simple tenant_admin.
    const TENANT_WIDE_ROLES = ['tenant_owner', 'tenant_admin', 'national_admin'];
    if (TENANT_WIDE_ROLES.includes(roleName)) {
      const isTenantOwner = actor.roles.some((r) => r.role.name === 'tenant_owner');
      if (!isTenantOwner) {
        throw new ForbiddenError(
          "Seul le Responsable de l'organisation peut attribuer ce role d'administration globale",
        );
      }
    }

    return;
  }

  if (actorScope.kind === 'region') {
    if (!['district_leader', 'assembly_pastor', 'assembly_admin', 'ministry_leader', 'member'].includes(roleName)) {
      throw new ForbiddenError("Vous ne pouvez pas attribuer ce role");
    }
    if (scope.regionId && scope.regionId !== actorScope.regionId) {
      throw new ForbiddenError("Vous ne pouvez attribuer des roles qu'a l'interieur de votre region");
    }
    if (scope.districtId) {
      await assertDistrictAccess(actor, scope.districtId);
    }
    if (scope.assemblyId) {
      await assertAssemblyAccess(actor, scope.assemblyId);
    }
    return;
  }

  if (actorScope.kind === 'district') {
    if (!['assembly_pastor', 'assembly_admin', 'ministry_leader', 'member'].includes(roleName)) {
      throw new ForbiddenError("Vous ne pouvez pas attribuer ce role");
    }
    if (scope.regionId || (scope.districtId && scope.districtId !== actorScope.districtId)) {
      throw new ForbiddenError("Vous ne pouvez attribuer des roles qu'a l'interieur de votre district");
    }
    if (scope.assemblyId) {
      await assertAssemblyAccess(actor, scope.assemblyId);
    }
    return;
  }

  if (actorScope.kind === 'assembly') {
    if (!['assembly_admin', 'ministry_leader', 'member'].includes(roleName)) {
      throw new ForbiddenError("Vous ne pouvez pas attribuer ce role");
    }
    if (scope.regionId || scope.districtId || (scope.assemblyId && scope.assemblyId !== actorScope.assemblyId)) {
      throw new ForbiddenError("Vous ne pouvez attribuer des roles qu'a l'interieur de votre assemblee");
    }
    return;
  }

  throw new ForbiddenError("Vous n'avez pas de perimetre de delegation valide");
}

export async function assertAnnouncementTargetScope(
  actor: AuthUser,
  input: {
    level: AnnouncementLevel;
    regionId?: string | null;
    districtId?: string | null;
    assemblyId?: string | null;
    ministryId?: string | null;
  },
): Promise<void> {
  const actorScope = await getActorScope(actor);

  if (actorScope.kind === 'platform' || actorScope.kind === 'tenant') return;

  if (input.level === 'NATIONAL') {
    throw new ForbiddenError('Seul le niveau national peut cibler tout le pays');
  }

  if (input.regionId) await assertRegionAccess(actor, input.regionId);
  if (input.districtId) await assertDistrictAccess(actor, input.districtId);
  if (input.assemblyId) await assertAssemblyAccess(actor, input.assemblyId);

  if (input.ministryId) {
    const ministry = await prisma.ministry.findUnique({
      where: { id: input.ministryId, deletedAt: null },
      select: { assemblyId: true },
    });
    if (!ministry) throw new NotFoundError('Ministere');
    await assertAssemblyAccess(actor, ministry.assemblyId);
  }

  if (actorScope.kind === 'region' && !['REGIONAL', 'DISTRICT', 'ASSEMBLY', 'MINISTRY'].includes(input.level)) {
    throw new ForbiddenError('Niveau de publication non autorise');
  }

  if (actorScope.kind === 'district' && !['DISTRICT', 'ASSEMBLY', 'MINISTRY'].includes(input.level)) {
    throw new ForbiddenError('Niveau de publication non autorise');
  }

  if (actorScope.kind === 'assembly' && !['ASSEMBLY', 'MINISTRY'].includes(input.level)) {
    throw new ForbiddenError('Niveau de publication non autorise');
  }
}

export async function assertCircularTargetScope(
  actor: AuthUser,
  input: {
    level: string;
    regionId?: string | null;
    districtId?: string | null;
  },
): Promise<void> {
  const actorScope = await getActorScope(actor);

  if (actorScope.kind === 'platform' || actorScope.kind === 'tenant') return;

  if (input.level === 'NATIONAL') {
    throw new ForbiddenError('Seul le niveau national peut publier une circulaire nationale');
  }

  if (input.regionId) await assertRegionAccess(actor, input.regionId);
  if (input.districtId) await assertDistrictAccess(actor, input.districtId);

  if (actorScope.kind === 'region' && !['REGIONAL', 'DISTRICT'].includes(input.level)) {
    throw new ForbiddenError('Niveau de circulaire non autorise');
  }

  if (actorScope.kind !== 'region' && input.level !== 'DISTRICT') {
    throw new ForbiddenError('Niveau de circulaire non autorise');
  }
}

export async function assertEventTargetScope(
  actor: AuthUser,
  input: {
    level: string;
    regionId?: string | null;
    districtId?: string | null;
    assemblyId?: string | null;
  },
): Promise<void> {
  const actorScope = await getActorScope(actor);

  if (actorScope.kind === 'platform' || actorScope.kind === 'tenant') return;

  if (input.level === 'NATIONAL') {
    throw new ForbiddenError('Seul le niveau national peut publier un evenement national');
  }

  if (input.regionId) await assertRegionAccess(actor, input.regionId);
  if (input.districtId) await assertDistrictAccess(actor, input.districtId);
  if (input.assemblyId) await assertAssemblyAccess(actor, input.assemblyId);

  if (actorScope.kind === 'region' && !['REGIONAL', 'DISTRICT', 'ASSEMBLY'].includes(input.level)) {
    throw new ForbiddenError("Niveau d'evenement non autorise");
  }

  if (actorScope.kind === 'district' && !['DISTRICT', 'ASSEMBLY'].includes(input.level)) {
    throw new ForbiddenError("Niveau d'evenement non autorise");
  }

  if (actorScope.kind === 'assembly' && input.level !== 'ASSEMBLY') {
    throw new ForbiddenError("Niveau d'evenement non autorise");
  }
}

export async function buildAnnouncementVisibilityFilter(user: AuthUser): Promise<Prisma.AnnouncementWhereInput> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return {};

  if (scope.kind === 'tenant') return { tenantId: scope.tenantId };

  const clauses: Prisma.AnnouncementWhereInput[] = [{ level: 'NATIONAL' }];

  if (scope.kind === 'region') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', district: { regionId: scope.regionId } });
    clauses.push({ level: 'ASSEMBLY', assembly: { district: { regionId: scope.regionId } } });
    clauses.push({ level: 'MINISTRY', ministry: { assembly: { district: { regionId: scope.regionId } } } });
  }

  if (scope.kind === 'district') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assembly: { districtId: scope.districtId } });
    clauses.push({ level: 'MINISTRY', ministry: { assembly: { districtId: scope.districtId } } });
  }

  if (scope.kind === 'assembly') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assemblyId: scope.assemblyId });
    clauses.push({ level: 'MINISTRY', ministry: { assemblyId: scope.assemblyId } });
  }

  if (scope.kind === 'none') return { id: 'NONE' };

  return { tenantId: scope.tenantId, OR: clauses };
}

export async function buildNewsPostVisibilityFilter(user: AuthUser): Promise<Prisma.NewsPostWhereInput> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return {};

  if (scope.kind === 'tenant') return { tenantId: scope.tenantId };

  const clauses: Prisma.NewsPostWhereInput[] = [{ level: 'NATIONAL' }];

  if (scope.kind === 'region') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districts: { regionId: scope.regionId } });
    clauses.push({ level: 'ASSEMBLY', assemblies: { district: { regionId: scope.regionId } } });
    clauses.push({ level: 'MINISTRY', ministries: { assembly: { district: { regionId: scope.regionId } } } });
  }

  if (scope.kind === 'district') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assemblies: { districtId: scope.districtId } });
    clauses.push({ level: 'MINISTRY', ministries: { assembly: { districtId: scope.districtId } } });
  }

  if (scope.kind === 'assembly') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assemblyId: scope.assemblyId });
    clauses.push({ level: 'MINISTRY', ministries: { assemblyId: scope.assemblyId } });
  }

  if (scope.kind === 'none') return { id: 'NONE' };

  return { tenantId: scope.tenantId, OR: clauses };
}

export async function buildCircularVisibilityFilter(user: AuthUser): Promise<Prisma.CircularWhereInput> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return {};

  if (scope.kind === 'tenant') return { tenantId: scope.tenantId };

  const clauses: Prisma.CircularWhereInput[] = [{ level: 'NATIONAL' }];

  if (scope.kind === 'region') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', district: { regionId: scope.regionId } });
  }

  if (scope.kind === 'district') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
  }

  if (scope.kind === 'assembly') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
  }

  if (scope.kind === 'none') return { id: 'NONE' };

  return { tenantId: scope.tenantId, OR: clauses };
}

export async function buildEventVisibilityFilter(user: AuthUser): Promise<Prisma.EventWhereInput> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return {};

  if (scope.kind === 'tenant') return { tenantId: scope.tenantId };

  const clauses: Prisma.EventWhereInput[] = [{ level: 'NATIONAL' }];

  if (scope.kind === 'region') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', district: { regionId: scope.regionId } });
    clauses.push({ level: 'ASSEMBLY', assembly: { district: { regionId: scope.regionId } } });
  }

  if (scope.kind === 'district') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assembly: { districtId: scope.districtId } });
  }

  if (scope.kind === 'assembly') {
    clauses.push({ level: 'REGIONAL', regionId: scope.regionId });
    clauses.push({ level: 'DISTRICT', districtId: scope.districtId });
    clauses.push({ level: 'ASSEMBLY', assemblyId: scope.assemblyId });
  }

  if (scope.kind === 'none') return { id: 'NONE' };

  return { tenantId: scope.tenantId, OR: clauses };
}

export async function getScopedAssignmentWhere(user: AuthUser): Promise<Prisma.AssignmentWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':
      return {
        OR: [
          { region: { tenantId: scope.tenantId } },
          { district: { region: { tenantId: scope.tenantId } } },
          { assembly: { district: { region: { tenantId: scope.tenantId } } } },
        ],
      };
    case 'region':
      return {
        OR: [
          { regionId: scope.regionId },
          { district: { regionId: scope.regionId } },
          { assembly: { district: { regionId: scope.regionId } } },
        ],
      };
    case 'district':
      return {
        OR: [
          { districtId: scope.districtId },
          { assembly: { districtId: scope.districtId } },
        ],
      };
    case 'assembly': return { assemblyId: scope.assemblyId };
    default: return { id: 'NONE' };
  }
}

export async function getScopedTransferWhere(user: AuthUser): Promise<Prisma.TransferWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':
      return {
        OR: [
          { fromAssembly: { district: { region: { tenantId: scope.tenantId } } } },
          { toAssembly: { district: { region: { tenantId: scope.tenantId } } } },
        ],
      };
    case 'region':
      return {
        OR: [
          { fromAssembly: { district: { regionId: scope.regionId } } },
          { toAssembly: { district: { regionId: scope.regionId } } },
        ],
      };
    case 'district':
      return {
        OR: [
          { fromAssembly: { districtId: scope.districtId } },
          { toAssembly: { districtId: scope.districtId } },
        ],
      };
    case 'assembly':
      return {
        OR: [
          { fromAssemblyId: scope.assemblyId },
          { toAssemblyId: scope.assemblyId },
        ],
      };
    default: return { id: 'NONE' };
  }
}

export async function getScopedPastorWhere(user: AuthUser): Promise<Prisma.PastorWhereInput> {
  const scope = await getActorScope(user);

  if (scope.kind === 'platform') return {};

  const assemblyWhere = await getScopedAssemblyWhere(user);
  return { assembly: assemblyWhere };
}

export async function getScopedTerritoryAccountWhere(user: AuthUser): Promise<Prisma.TerritoryAccountWhereInput> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':
      return {
        OR: [
          { region: { tenantId: scope.tenantId } },
          { district: { region: { tenantId: scope.tenantId } } },
          { assembly: { district: { region: { tenantId: scope.tenantId } } } },
        ],
      };
    case 'region':
      return {
        OR: [
          { regionId: scope.regionId },
          { district: { regionId: scope.regionId } },
          { assembly: { district: { regionId: scope.regionId } } },
        ],
      };
    case 'district':
      return {
        OR: [
          { districtId: scope.districtId },
          { assembly: { districtId: scope.districtId } },
        ],
      };
    case 'assembly': return { assemblyId: scope.assemblyId };
    default: return { id: 'NONE' };
  }
}

export async function assertAssignmentAccess(user: AuthUser, assignment: {
  assemblyId?: string | null;
  districtId?: string | null;
  regionId?: string | null;
}): Promise<void> {
  if (isSuperAdmin(user)) return;
  if (assignment.assemblyId) { await assertAssemblyAccess(user, assignment.assemblyId); return; }
  if (assignment.districtId) { await assertDistrictAccess(user, assignment.districtId); return; }
  if (assignment.regionId)   { await assertRegionAccess(user, assignment.regionId); return; }
  throw new ForbiddenError('Accès à cette affectation refusé');
}

export async function assertTerritoryAccountAccess(user: AuthUser, account: {
  assemblyId?: string | null;
  districtId?: string | null;
  regionId?: string | null;
}): Promise<void> {
  if (isSuperAdmin(user)) return;
  if (account.assemblyId) { await assertAssemblyAccess(user, account.assemblyId); return; }
  if (account.districtId) { await assertDistrictAccess(user, account.districtId); return; }
  if (account.regionId)   { await assertRegionAccess(user, account.regionId); return; }
  throw new ForbiddenError('Accès à ce compte territoire refusé');
}

export async function getScopedSoulWhere(user: AuthUser): Promise<Prisma.NewVisitorWhereInput> {
  const scope = await getActorScope(user);
  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':   return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':   return { assembly: { district: { regionId: scope.regionId } } };
    case 'district': return { assembly: { districtId: scope.districtId } };
    case 'assembly': return { assemblyId: scope.assemblyId };
    default:         return { id: 'NONE' };
  }
}

export async function getScopedFamilyWhere(user: AuthUser): Promise<Prisma.FamilyOfDisciplesWhereInput> {
  const scope = await getActorScope(user);
  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':   return { tenantId: scope.tenantId };
    case 'region':   return { assembly: { district: { regionId: scope.regionId } } };
    case 'district': return { assembly: { districtId: scope.districtId } };
    case 'assembly': return { assemblyId: scope.assemblyId };
    default:         return { id: 'NONE' };
  }
}

export async function getScopedDiscipleMakerWhere(user: AuthUser): Promise<Prisma.DiscipleMakerProfileWhereInput> {
  const scope = await getActorScope(user);
  switch (scope.kind) {
    case 'platform': return {};
    case 'tenant':   return { tenantId: scope.tenantId };
    case 'region':   return { family: { assembly: { district: { regionId: scope.regionId } } } };
    case 'district': return { family: { assembly: { districtId: scope.districtId } } };
    case 'assembly': return { family: { assemblyId: scope.assemblyId } };
    default:         return { id: 'NONE' };
  }
}

export function assertEntityMatchesScope(input: {
  regionId?: string | null;
  districtId?: string | null;
  assemblyId?: string | null;
}) {
  const populated = [input.regionId, input.districtId, input.assemblyId].filter(Boolean).length;
  if (populated > 1) {
    throw new AppError('Le scope cible doit pointer vers un seul niveau territorial a la fois', 400, 'INVALID_SCOPE');
  }
}
