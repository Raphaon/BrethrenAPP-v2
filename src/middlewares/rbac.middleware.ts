import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.util';
import { PERMISSIONS, PermissionValue } from '../shared/constants/permissions';

/**
 * Verifie qu'une permission est dans les roles actifs de l'utilisateur.
 * Prend en compte le perimetre territorial (regionId, districtId, assemblyId).
 */
export function requirePermission(...permissions: PermissionValue[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, "Non authentifie", 401, 'UNAUTHORIZED');
      return;
    }

    if (isSuperAdmin(req.user)) {
      next();
      return;
    }

    const userPermissions = getUserPermissions(req.user.roles);
    const hasPermission = permissions.every((permission) => userPermissions.has(permission));

    if (!hasPermission) {
      sendError(res, 'Permissions insuffisantes pour cette action', 403, 'FORBIDDEN');
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: PermissionValue[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, "Non authentifie", 401, 'UNAUTHORIZED');
      return;
    }

    if (isSuperAdmin(req.user)) {
      next();
      return;
    }

    const userPermissions = getUserPermissions(req.user.roles);
    const hasAny = permissions.some((permission) => userPermissions.has(permission));

    if (!hasAny) {
      sendError(res, 'Permissions insuffisantes', 403, 'FORBIDDEN');
      return;
    }

    next();
  };
}

export function getUserPermissions(
  roles: NonNullable<Request['user']>['roles'],
): Set<string> {
  if (roles.some((userRole) => userRole.role.name === 'super_admin')) {
    return new Set(Object.values(PERMISSIONS));
  }

  const permissions = new Set<string>();

  for (const userRole of roles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(rolePermission.permission.name);
    }
  }

  return permissions;
}

export function userHasPermission(
  user: NonNullable<Request['user']>,
  permission: PermissionValue,
): boolean {
  return getUserPermissions(user.roles).has(permission);
}

export function getUserRoleLevel(user: NonNullable<Request['user']>): number {
  // Retourne le niveau le plus eleve (le plus petit numeriquement)
  const levels = user.roles.map((userRole) => userRole.role.level);
  return levels.length > 0 ? Math.min(...levels) : 99;
}

export function isSuperAdmin(user: NonNullable<Request['user']>): boolean {
  return user.roles.some((userRole) => userRole.role.name === 'super_admin');
}

export function isPlatformAdmin(user: NonNullable<Request['user']>): boolean {
  return isSuperAdmin(user);
}

export function isTenantWideAdmin(user: NonNullable<Request['user']>): boolean {
  return user.roles.some((userRole) =>
    ['super_admin', 'tenant_owner', 'tenant_admin', 'national_admin'].includes(userRole.role.name),
  );
}

export function isNationalAdmin(user: NonNullable<Request['user']>): boolean {
  return isTenantWideAdmin(user);
}

/**
 * Exact-match helpers - only check the user's own scope tokens.
 * Hierarchy (e.g. region-level user accessing a district) is resolved by the
 * async requireXxxScope middlewares via DB lookup.
 */
export function userHasRegionScope(
  user: NonNullable<Request['user']>,
  regionId: string,
): boolean {
  if (isSuperAdmin(user)) return true;
  return user.roles.some((userRole) => userRole.regionId === regionId);
}

export function userHasDistrictScope(
  user: NonNullable<Request['user']>,
  districtId: string,
): boolean {
  if (isSuperAdmin(user)) return true;
  return user.roles.some((userRole) => userRole.districtId === districtId);
}

export function userHasAssemblyScope(
  user: NonNullable<Request['user']>,
  assemblyId: string,
): boolean {
  if (isSuperAdmin(user)) return true;
  return user.roles.some((userRole) => userRole.assemblyId === assemblyId);
}
