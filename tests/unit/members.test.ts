import { MembersService } from '../../src/modules/members/members.service';
import { prismaMock } from '../helpers/test-setup';
import { AppError } from '../../src/middlewares/error.middleware';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/matricule.util', () => ({
  generateMatricule: jest.fn().mockResolvedValue('ACY-24-00099'),
}));
jest.mock('../../src/middlewares/scope.middleware', () => ({
  buildMemberScopeFilter: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/plan-limit.service', () => ({
  planLimitService: { assertCanCreateMember: jest.fn().mockResolvedValue(undefined) },
}));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const currentUser: AuthUser = {
  id: 'user-1', tenantId: 'tenant-1',
  email: 'admin@test.com', firstName: 'Admin', lastName: 'Test', status: 'ACTIVE',
  roles: [{ role: { name: 'super_admin', level: 1, rolePermissions: [] }, regionId: null, districtId: null, assemblyId: null, ministryId: null }],
} as unknown as AuthUser;

describe('MembersService', () => {
  let membersService: MembersService;

  beforeEach(() => {
    membersService = new MembersService();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should throw NotFoundError when assembly not found', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue(null);

      await expect(
        membersService.create(
          { firstName: 'Test', lastName: 'Member', gender: 'MALE', assemblyId: 'nonexistent-id', status: 'ACTIVE' },
          'user-1', mockReq, currentUser
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
    });

    it('should create member with generated matricule', async () => {
      const mockAssembly = { id: 'assembly-1', code: 'ACY' };
      const expectedMember = {
        id: 'member-1', matricule: 'ACY-24-00099',
        firstName: 'Test', lastName: 'Member', gender: 'MALE',
        assemblyId: 'assembly-1', status: 'ACTIVE',
        assembly: { id: 'assembly-1', name: 'Test Assembly', district: { id: 'd1', name: 'D1', region: { id: 'r1', name: 'R1' } } },
        preachingPoint: null, ministryMembers: [],
      };

      prismaMock.assembly.findUnique.mockResolvedValue(mockAssembly as any);
      prismaMock.member.create.mockResolvedValue(expectedMember as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await membersService.create(
        { firstName: 'Test', lastName: 'Member', gender: 'MALE', assemblyId: 'assembly-1', status: 'ACTIVE' },
        'user-1', mockReq, currentUser
      );

      expect(result.matricule).toBe('ACY-24-00099');
      expect(prismaMock.member.create).toHaveBeenCalledTimes(1);
    });

    it('should include optional fields when provided', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue({ id: 'a-1', code: 'A1' } as any);
      prismaMock.member.create.mockResolvedValue({
        id: 'm-2', matricule: 'ACY-24-00099', firstName: 'Marie', lastName: 'Nguema',
        gender: 'FEMALE', phone: '+237699000001', assemblyId: 'a-1', status: 'ACTIVE',
        assembly: { id: 'a-1', name: 'A1', district: { id: 'd1', name: 'D1', region: { id: 'r1', name: 'R1' } } },
        preachingPoint: null, ministryMembers: [],
      } as any);

      const result = await membersService.create(
        { firstName: 'Marie', lastName: 'Nguema', gender: 'FEMALE', assemblyId: 'a-1', phone: '+237699000001', status: 'ACTIVE' },
        'user-1', mockReq, currentUser
      );
      expect(result.firstName).toBe('Marie');
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should throw NotFoundError when member not found', async () => {
      prismaMock.member.findUnique.mockResolvedValue(null);
      await expect(
        membersService.softDelete('nonexistent', 'user-1', mockReq, currentUser)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
    });

    it('should set deletedAt and status INACTIVE', async () => {
      prismaMock.member.findUnique.mockResolvedValue({ id: 'member-1', assemblyId: 'a-1' } as any);
      prismaMock.member.update.mockResolvedValue({} as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      await membersService.softDelete('member-1', 'user-1', mockReq, currentUser);

      expect(prismaMock.member.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'INACTIVE' }) })
      );
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should return paginated members', async () => {
      prismaMock.$transaction.mockResolvedValue([[{ id: 'm-1' }], 1] as any);
      const result = await membersService.list({ page: 1, limit: 25, skip: 0 }, {}, currentUser);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should return empty list when no members', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0] as any);
      const result = await membersService.list({ page: 1, limit: 25, skip: 0 }, {}, currentUser);
      expect(result.data).toHaveLength(0);
    });
  });
});
