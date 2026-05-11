import { Prisma, UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { hashPassword } from '../../utils/password.util';
import { createAuditLog } from '../../utils/audit.util';
import { buildPaginationMeta } from '../../utils/response.util';
import { AppError, ConflictError, NotFoundError } from '../../middlewares/error.middleware';
import type { CreateUserDto, UpdateUserDto, AssignRoleDto } from './users.validation';
import type { PaginationParams } from '../../utils/pagination.util';
import { Request } from 'express';
import { notifyUsers } from '../../utils/notify.util';
import { AuthUser } from '../../shared/types/express';
import {
  assertAssignableRole,
  assertManageableMember,
  assertManageableUser,
  getScopedUserWhere,
} from '../../utils/scope-access.util';

const userSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  avatar: true,
  status: true,
  memberId: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  member: {
    select: {
      id: true,
      matricule: true,
      assemblyId: true,
      assembly: {
        select: {
          id: true,
          name: true,
          districtId: true,
          district: {
            select: {
              id: true,
              name: true,
              regionId: true,
              region: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
  userRoles: {
    include: {
      role: { select: { id: true, name: true, displayName: true, level: true } },
      region: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
      assembly: { select: { id: true, name: true } },
      ministry: { select: { id: true, name: true } },
    },
  },
};

export class UsersService {
  async list(
    pagination: PaginationParams,
    filters: {
      search?: string;
      status?: string;
      roleId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    currentUser: AuthUser,
  ) {
    const scopeWhere = await getScopedUserWhere(currentUser);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(filters.status && { status: filters.status as UserStatus }),
      ...(filters.roleId && {
        userRoles: { some: { roleId: filters.roleId } },
      }),
      AND: [
        scopeWhere,
        ...(filters.search
          ? [{
              OR: [
                { firstName: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
                { lastName: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
                { email: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
                { phone: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
              ],
            }]
          : []),
      ],
    };

    const [data, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: userSelect,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: {
          [['createdAt', 'firstName', 'lastName', 'email', 'status', 'lastLoginAt'].includes(filters.sortBy ?? '')
            ? filters.sortBy!
            : 'createdAt']: filters.sortOrder ?? 'desc',
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { data, pagination: buildPaginationMeta(total, pagination.page, pagination.limit) };
  }

  async findById(id: string, currentUser: AuthUser) {
    await assertManageableUser(currentUser, id);

    const user = await prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: userSelect,
    });
    if (!user) throw new NotFoundError('Utilisateur');
    return user;
  }

  async create(dto: CreateUserDto, actorId: string, req: Request, currentUser: AuthUser) {
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictError('Cet email est deja utilise');

    let tenantId = currentUser.tenantId ?? currentUser.roles.find((r) => r.tenantId)?.tenantId ?? null;

    if (dto.memberId) {
      await assertManageableMember(currentUser, dto.memberId);
      if (!tenantId) {
        const member = await prisma.member.findUnique({
          where: { id: dto.memberId },
          select: { assembly: { select: { district: { select: { region: { select: { tenantId: true } } } } } } },
        });
        tenantId = member?.assembly.district.region.tenantId ?? null;
      }
    }

    const hashedPassword = await hashPassword(dto.password);

    const user = await prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        firstName: dto.firstName,
        lastName: dto.lastName,
        password: hashedPassword,
        status: dto.status,
        memberId: dto.memberId,
        tenantId,
      },
      select: userSelect,
    });

    await createAuditLog({
      actorId,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      newValues: { email: user.email, firstName: user.firstName, lastName: user.lastName },
      req,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string, req: Request, currentUser: AuthUser) {
    await assertManageableUser(currentUser, id);

    const existing = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Utilisateur');

    if (dto.email && dto.email !== existing.email) {
      const emailUsed = await prisma.user.findUnique({ where: { email: dto.email } });
      if (emailUsed) throw new ConflictError('Cet email est deja utilise');
    }

    const user = await prisma.user.update({
      where: { id },
      data: dto,
      select: userSelect,
    });

    await createAuditLog({
      actorId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      oldValues: { email: existing.email, status: existing.status },
      newValues: dto,
      req,
    });

    return user;
  }

  async softDelete(id: string, actorId: string, req: Request, currentUser: AuthUser) {
    await assertManageableUser(currentUser, id);

    const existing = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Utilisateur');

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });

    await createAuditLog({
      actorId,
      action: 'DELETE',
      entityType: 'User',
      entityId: id,
      req,
    });
  }

  async toggleStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
    actorId: string,
    req: Request,
    currentUser: AuthUser,
  ) {
    await assertManageableUser(currentUser, id);

    const existing = await prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundError('Utilisateur');

    const user = await prisma.user.update({
      where: { id },
      data: { status },
      select: userSelect,
    });

    await createAuditLog({
      actorId,
      action: status === 'ACTIVE' ? 'ACCOUNT_ACTIVATE' : 'ACCOUNT_DEACTIVATE',
      entityType: 'User',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status },
      req,
    });

    return user;
  }

  async assignRole(userId: string, dto: AssignRoleDto, actorId: string, req: Request, currentUser: AuthUser) {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, memberId: true, member: { select: { assemblyId: true } } },
    });
    if (!user) throw new NotFoundError('Utilisateur');

    if (user.memberId || (await prisma.userRole.count({ where: { userId } })) > 0) {
      await assertManageableUser(currentUser, userId);
    }

    const role = await prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundError('Role');

    await assertAssignableRole(currentUser, role.name, dto);

    if (user.memberId) {
      await assertManageableMember(currentUser, user.memberId);

      if (dto.assemblyId && user.member?.assemblyId && dto.assemblyId !== user.member.assemblyId) {
        throw new AppError("Le role assigne doit rester coherent avec l'assemblee du membre lie", 400, 'USER_SCOPE_MISMATCH');
      }
    }

    const existingRole = await prisma.userRole.findFirst({
      where: {
        userId,
        roleId: dto.roleId,
        regionId: dto.regionId ?? null,
        districtId: dto.districtId ?? null,
        assemblyId: dto.assemblyId ?? null,
        ministryId: dto.ministryId ?? null,
      },
    });

    if (existingRole) {
      throw new ConflictError('Ce role est deja assigne avec ce perimetre');
    }

    const userRole = await prisma.userRole.create({
      data: {
        userId,
        roleId: dto.roleId,
        regionId: dto.regionId ?? null,
        districtId: dto.districtId ?? null,
        assemblyId: dto.assemblyId ?? null,
        ministryId: dto.ministryId ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        assignedBy: actorId,
      },
      include: {
        role: { select: { id: true, name: true, displayName: true } },
      },
    });

    await createAuditLog({
      actorId,
      action: 'ROLE_CHANGE',
      entityType: 'User',
      entityId: userId,
      newValues: {
        roleId: dto.roleId,
        roleName: role.name,
        regionId: dto.regionId ?? null,
        districtId: dto.districtId ?? null,
        assemblyId: dto.assemblyId ?? null,
        ministryId: dto.ministryId ?? null,
      },
      req,
    });

    void notifyUsers({
      title: 'Rôle assigné',
      message: `Le rôle "${role.displayName}" vous a été assigné.`,
      type: 'ROLE_ASSIGNED',
      entityType: 'User',
      entityId: userId,
      userIds: [userId],
    });

    return userRole;
  }

  async removeRole(userId: string, userRoleId: string, actorId: string, req: Request, currentUser: AuthUser) {
    await assertManageableUser(currentUser, userId);

    const userRole = await prisma.userRole.findFirst({
      where: { id: userRoleId, userId },
      include: { role: true },
    });
    if (!userRole) throw new NotFoundError('Role utilisateur');

    await assertAssignableRole(currentUser, userRole.role.name, {
      regionId: userRole.regionId,
      districtId: userRole.districtId,
      assemblyId: userRole.assemblyId,
      ministryId: userRole.ministryId,
    });

    await prisma.userRole.delete({ where: { id: userRoleId } });

    await createAuditLog({
      actorId,
      action: 'ROLE_CHANGE',
      entityType: 'User',
      entityId: userId,
      oldValues: { roleId: userRole.roleId, roleName: userRole.role.name },
      newValues: { removed: true },
      req,
    });
  }
}

export const usersService = new UsersService();
