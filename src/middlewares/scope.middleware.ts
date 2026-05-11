import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.util';
import {
  assertAssemblyAccess,
  assertDistrictAccess,
  assertRegionAccess,
  getActorScope,
} from '../utils/scope-access.util';
import { isTenantWideAdmin } from './rbac.middleware';

/**
 * Legacy helper kept for modules that only need a quick territorial hint.
 * Data-access paths should prefer getActorScope / assertXAccess helpers.
 */
export function buildTerritorialFilter(user: NonNullable<Request['user']>): {
  regionId?: string;
  districtId?: string;
  assemblyId?: string;
} {
  if (isTenantWideAdmin(user)) return {};

  const assemblyRole = user.roles.find((ur) => ur.assemblyId !== null);
  if (assemblyRole?.assemblyId) return { assemblyId: assemblyRole.assemblyId };

  const districtRole = user.roles.find((ur) => ur.districtId !== null);
  if (districtRole?.districtId) return { districtId: districtRole.districtId };

  const regionRole = user.roles.find((ur) => ur.regionId !== null);
  if (regionRole?.regionId) return { regionId: regionRole.regionId };

  return { assemblyId: 'NONE' };
}

export async function requireAssemblyScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    sendError(res, 'Non authentifie', 401, 'UNAUTHORIZED');
    return;
  }

  const assemblyId = req.params['assemblyId'] || req.body?.assemblyId;
  if (!assemblyId) {
    next();
    return;
  }

  try {
    await assertAssemblyAccess(req.user, assemblyId);
    next();
  } catch (err: any) {
    sendError(res, err.message ?? 'Acces a cette assemblee refuse', err.statusCode ?? 403, err.code ?? 'SCOPE_DENIED');
  }
}

export async function requireDistrictScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    sendError(res, 'Non authentifie', 401, 'UNAUTHORIZED');
    return;
  }

  const districtId = req.params['districtId'] || req.body?.districtId;
  if (!districtId) {
    next();
    return;
  }

  try {
    await assertDistrictAccess(req.user, districtId);
    next();
  } catch (err: any) {
    sendError(res, err.message ?? 'Acces a ce district refuse', err.statusCode ?? 403, err.code ?? 'SCOPE_DENIED');
  }
}

export async function requireRegionScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    sendError(res, 'Non authentifie', 401, 'UNAUTHORIZED');
    return;
  }

  const regionId = req.params['regionId'] || req.body?.regionId;
  if (!regionId) {
    next();
    return;
  }

  try {
    await assertRegionAccess(req.user, regionId);
    next();
  } catch (err: any) {
    sendError(res, err.message ?? 'Acces a cette region refuse', err.statusCode ?? 403, err.code ?? 'SCOPE_DENIED');
  }
}

export async function buildMemberScopeFilter(
  user: NonNullable<Request['user']>
): Promise<Record<string, unknown>> {
  const scope = await getActorScope(user);

  switch (scope.kind) {
    case 'platform':
      return {};
    case 'tenant':
      return { assembly: { district: { region: { tenantId: scope.tenantId } } } };
    case 'region':
      return { assembly: { district: { regionId: scope.regionId, region: { tenantId: scope.tenantId } } } };
    case 'district':
      return { assembly: { districtId: scope.districtId, district: { region: { tenantId: scope.tenantId } } } };
    case 'assembly':
      return { assemblyId: scope.assemblyId };
    default:
      return { assemblyId: 'NONE' };
  }
}
