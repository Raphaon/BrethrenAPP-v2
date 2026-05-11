import { AssembliesService } from '../../src/modules/assemblies/assemblies.service';
import { prismaMock } from '../helpers/test-setup';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertAssemblyAccess: jest.fn().mockResolvedValue(undefined),
  assertDistrictAccess: jest.fn().mockResolvedValue(undefined),
  getScopedAssemblyWhere: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/plan-limit.service', () => ({
  planLimitService: { assertCanCreateAssembly: jest.fn().mockResolvedValue(undefined) },
}));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const admin = {
  id: 'user-1', email: 'admin@test.com', firstName: 'Admin', lastName: 'Test',
  status: 'ACTIVE',
  roles: [{ role: { name: 'super_admin', level: 1, rolePermissions: [] }, regionId: null, districtId: null, assemblyId: null, ministryId: null }],
} as unknown as AuthUser;
const pagination = { page: 1, limit: 25, skip: 0 };

const mockAssembly = {
  id: 'asm-1', name: 'Assemblée Centrale', districtId: 'd-1',
  district: { id: 'd-1', name: 'District Centre', region: { id: 'r-1', name: 'RC' } },
  preachingPoints: [], ministries: [], pastors: [],
  _count: { members: 0, preachingPoints: 0, ministries: 0 },
};

describe('AssembliesService', () => {
  let service: AssembliesService;
  beforeEach(() => { service = new AssembliesService(); });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('should return paginated assemblies', async () => {
      prismaMock.$transaction.mockResolvedValue([[mockAssembly], 1] as any);
      const result = await service.list(pagination, {}, admin);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should return empty when filter yields no results', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0] as any);
      const result = await service.list(pagination, { districtId: 'nonexistent' }, admin);
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('should return assembly with nested data', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue(mockAssembly as any);
      const result = await service.findById('asm-1', admin);
      expect(result.id).toBe('asm-1');
    });

    it('should throw NotFoundError when assembly does not exist', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue(null);
      await expect(service.findById('asm-999', admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should throw NotFoundError when district does not exist', async () => {
      prismaMock.district.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'Asm X', districtId: 'd-999', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    const mockDistrict = { id: 'd-1', region: { tenantId: 'tenant-1' } };

    it('should throw ConflictError when assembly name already exists in district', async () => {
      prismaMock.district.findUnique.mockResolvedValue(mockDistrict as any);
      prismaMock.assembly.findFirst.mockResolvedValue({ id: 'asm-1', name: 'Assemblée Centrale' } as any);
      await expect(
        service.create({ name: 'Assemblée Centrale', districtId: 'd-1', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should create assembly successfully', async () => {
      prismaMock.district.findUnique.mockResolvedValue(mockDistrict as any);
      prismaMock.assembly.findFirst.mockResolvedValue(null);
      prismaMock.assembly.create.mockResolvedValue(mockAssembly as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.create({ name: 'Assemblée Centrale', districtId: 'd-1', status: 'ACTIVE' as const }, 'user-1', mockReq, admin);
      expect(result.name).toBe('Assemblée Centrale');
    });

    it('should handle optional foundedAt date', async () => {
      prismaMock.district.findUnique.mockResolvedValue(mockDistrict as any);
      prismaMock.assembly.findFirst.mockResolvedValue(null);
      prismaMock.assembly.create.mockResolvedValue(mockAssembly as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      await expect(
        service.create({ name: 'New Asm', districtId: 'd-1', foundedAt: '2000-01-15', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).resolves.toBeDefined();
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should throw NotFoundError when assembly does not exist', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue(null);
      await expect(service.update('asm-999', { name: 'X' }, 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should update assembly successfully', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue({ id: 'asm-1', name: 'Old Name' } as any);
      prismaMock.assembly.update.mockResolvedValue({ ...mockAssembly, name: 'New Name' } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.update('asm-1', { name: 'New Name' }, 'user-1', mockReq, admin);
      expect(result.name).toBe('New Name');
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────
  describe('softDelete', () => {
    it('should throw NotFoundError when assembly does not exist', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue(null);
      await expect(service.softDelete('asm-999', 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should soft delete assembly', async () => {
      prismaMock.assembly.findUnique.mockResolvedValue({ id: 'asm-1' } as any);
      prismaMock.assembly.update.mockResolvedValue({} as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);
      await expect(service.softDelete('asm-1', 'user-1', mockReq, admin)).resolves.toBeUndefined();
    });
  });
});
