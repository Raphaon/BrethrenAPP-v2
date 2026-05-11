import { UsersService } from '../../src/modules/users/users.service';
import { prismaMock } from '../helpers/test-setup';
import * as passwordUtil from '../../src/utils/password.util';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/notify.util', () => ({ notifyUsers: jest.fn() }));
jest.mock('../../src/utils/password.util');
jest.mock('../../src/utils/scope-access.util', () => ({
  assertManageableUser: jest.fn().mockResolvedValue(undefined),
  assertManageableMember: jest.fn().mockResolvedValue(undefined),
  assertAssignableRole: jest.fn().mockResolvedValue(undefined),
  getScopedUserWhere: jest.fn().mockResolvedValue({}),
}));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const admin = {
  id: 'user-1', email: 'admin@test.com', firstName: 'Admin', lastName: 'Test',
  status: 'ACTIVE',
  roles: [{ role: { name: 'super_admin', level: 1, rolePermissions: [] }, regionId: null, districtId: null, assemblyId: null, ministryId: null }],
} as unknown as AuthUser;
const pagination = { page: 1, limit: 25, skip: 0 };

const mockUser = {
  id: 'user-2', email: 'member@test.com', firstName: 'Jean', lastName: 'Dupont',
  phone: null, avatar: null, status: 'ACTIVE', memberId: null, lastLoginAt: null,
  createdAt: new Date(), updatedAt: new Date(), member: null, userRoles: [],
};

describe('UsersService', () => {
  let service: UsersService;
  beforeEach(() => { service = new UsersService(); });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('should return paginated users', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockUser], 1] as any);
      const result = await service.list(pagination, {}, admin);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should return empty list when no users match filter', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0] as any);
      const result = await service.list(pagination, { status: 'SUSPENDED' }, admin);
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('should return user by id', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      const result = await service.findById('user-2', admin);
      expect(result.id).toBe('user-2');
    });

    it('should throw NotFoundError when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('user-999', admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should throw ConflictError when email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      await expect(
        service.create({ email: 'member@test.com', firstName: 'A', lastName: 'B', password: 'Test@1234', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should create user with hashed password', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      (passwordUtil.hashPassword as jest.Mock).mockResolvedValue('hashed_pass');
      prismaMock.user.create.mockResolvedValue(mockUser as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.create(
        { email: 'new@test.com', firstName: 'Jean', lastName: 'Paul', password: 'Test@1234', status: 'ACTIVE' as const },
        'user-1', mockReq, admin
      );
      expect(result.id).toBe('user-2');
      expect(passwordUtil.hashPassword).toHaveBeenCalledWith('Test@1234');
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should throw NotFoundError when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.update('user-999', { firstName: 'X' }, 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw ConflictError when new email is already used', async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(mockUser as any)      // existing user
        .mockResolvedValueOnce({ id: 'other-user' } as any); // email already used

      await expect(
        service.update('user-2', { email: 'taken@test.com' }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should update user successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.user.update.mockResolvedValue({ ...mockUser, firstName: 'Updated' } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.update('user-2', { firstName: 'Updated' }, 'user-1', mockReq, admin);
      expect(result.firstName).toBe('Updated');
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────
  describe('softDelete', () => {
    it('should throw NotFoundError when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.softDelete('user-999', 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should soft delete user and set INACTIVE', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.user.update.mockResolvedValue({} as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);
      await expect(service.softDelete('user-2', 'user-1', mockReq, admin)).resolves.toBeUndefined();
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'INACTIVE' }) })
      );
    });
  });

  // ─── toggleStatus ──────────────────────────────────────────────────────────
  describe('toggleStatus', () => {
    it('should throw NotFoundError when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.toggleStatus('user-999', 'ACTIVE', 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should activate user', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...mockUser, status: 'INACTIVE' } as any);
      prismaMock.user.update.mockResolvedValue({ ...mockUser, status: 'ACTIVE' } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.toggleStatus('user-2', 'ACTIVE', 'user-1', mockReq, admin);
      expect(result.status).toBe('ACTIVE');
    });

    it('should suspend user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      prismaMock.user.update.mockResolvedValue({ ...mockUser, status: 'SUSPENDED' } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.toggleStatus('user-2', 'SUSPENDED', 'user-1', mockReq, admin);
      expect(result.status).toBe('SUSPENDED');
    });
  });

  // ─── assignRole ────────────────────────────────────────────────────────────
  describe('assignRole', () => {
    it('should throw NotFoundError when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(
        service.assignRole('user-999', { roleId: 'role-1' }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw NotFoundError when role does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-2', memberId: null, member: null } as any);
      prismaMock.userRole.count.mockResolvedValue(0);
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(
        service.assignRole('user-2', { roleId: 'role-999' }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw ConflictError when role already assigned with same scope', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-2', memberId: null, member: null } as any);
      prismaMock.userRole.count.mockResolvedValue(0);
      prismaMock.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'responsable', displayName: 'Responsable' } as any);
      prismaMock.userRole.findFirst.mockResolvedValue({ id: 'ur-1' } as any);

      await expect(
        service.assignRole('user-2', { roleId: 'role-1' }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should assign role successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-2', memberId: null, member: null } as any);
      prismaMock.userRole.count.mockResolvedValue(0);
      prismaMock.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'responsable', displayName: 'Responsable' } as any);
      prismaMock.userRole.findFirst.mockResolvedValue(null);
      prismaMock.userRole.create.mockResolvedValue({ id: 'ur-new', roleId: 'role-1', role: { id: 'role-1', name: 'responsable', displayName: 'Responsable' } } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.assignRole('user-2', { roleId: 'role-1' }, 'user-1', mockReq, admin);
      expect(result.roleId).toBe('role-1');
    });
  });
});
