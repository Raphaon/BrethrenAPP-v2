import { UserRole, Role, Permission } from '@prisma/client';

export interface AuthUser {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan?: {
      code: string;
      name: string;
    } | null;
  } | null;
  roles: Array<{
    role: Role & { rolePermissions: Array<{ permission: Permission }> };
    tenantId: string | null;
    regionId: string | null;
    districtId: string | null;
    assemblyId: string | null;
    ministryId: string | null;
  }>;
}

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: AuthUser;
      pagination?: {
        page: number;
        limit: number;
        skip: number;
      };
    }
  }
}
