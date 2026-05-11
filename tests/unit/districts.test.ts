import { DistrictsService } from '../../src/modules/districts/districts.service';
import { prismaMock } from '../helpers/test-setup';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertDistrictAccess: jest.fn().mockResolvedValue(undefined),
  assertRegionAccess: jest.fn().mockResolvedValue(undefined),
  getScopedDistrictWhere: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/plan-limit.service', () => ({
  planLimitService: { assertCanCreateDistrict: jest.fn().mockResolvedValue(undefined) },
}));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const admin = {
  id: 'user-1', email: 'admin@test.com', firstName: 'Admin', lastName: 'Test',
  status: 'ACTIVE',
  roles: [{ role: { name: 'super_admin', level: 1, rolePermissions: [] }, regionId: null, districtId: null, assemblyId: null, ministryId: null }],
} as unknown as AuthUser;
const pagination = { page: 1, limit: 25, skip: 0 };

describe('DistrictsService', () => {
  let service: DistrictsService;
  beforeEach(() => { service = new DistrictsService(); });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('should return paginated districts', async () => {
      const mockDistricts = [{ id: 'd-1', name: 'District Centre', region: { id: 'r-1', name: 'RC' }, _count: { assemblies: 5 } }];
      prismaMock.$transaction.mockResolvedValue([mockDistricts, 1] as any);

      const result = await service.list(pagination, {}, admin);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by regionId', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0] as any);
      const result = await service.list(pagination, { regionId: 'r-1' }, admin);
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('should return district with assemblies', async () => {
      const mock = { id: 'd-1', name: 'District Centre', region: { id: 'r-1', name: 'RC' }, assemblies: [], _count: { assemblies: 0 } };
      prismaMock.district.findUnique.mockResolvedValue(mock as any);
      const result = await service.findById('d-1', admin);
      expect(result.id).toBe('d-1');
    });

    it('should throw NotFoundError when district does not exist', async () => {
      prismaMock.district.findUnique.mockResolvedValue(null);
      await expect(service.findById('d-999', admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should throw NotFoundError when region does not exist', async () => {
      prismaMock.region.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'District X', regionId: 'r-999', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw ConflictError when district name already exists in region', async () => {
      prismaMock.region.findUnique.mockResolvedValue({ id: 'r-1', tenantId: 'tenant-1' } as any);
      prismaMock.district.findFirst.mockResolvedValue({ id: 'd-1', name: 'District Centre' } as any);
      await expect(
        service.create({ name: 'District Centre', regionId: 'r-1', status: 'ACTIVE' as const }, 'user-1', mockReq, admin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should create district successfully', async () => {
      prismaMock.region.findUnique.mockResolvedValue({ id: 'r-1', tenantId: 'tenant-1' } as any);
      prismaMock.district.findFirst.mockResolvedValue(null);
      prismaMock.district.create.mockResolvedValue({ id: 'd-2', name: 'District Nord', region: { id: 'r-1', name: 'RC' } } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.create({ name: 'District Nord', regionId: 'r-1', status: 'ACTIVE' as const }, 'user-1', mockReq, admin);
      expect(result.id).toBe('d-2');
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should throw NotFoundError when district does not exist', async () => {
      prismaMock.district.findUnique.mockResolvedValue(null);
      await expect(service.update('d-999', { name: 'New' }, 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should update district successfully', async () => {
      prismaMock.district.findUnique.mockResolvedValue({ id: 'd-1', name: 'Old' } as any);
      prismaMock.district.update.mockResolvedValue({ id: 'd-1', name: 'Updated', region: { id: 'r-1', name: 'RC' } } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.update('d-1', { name: 'Updated' }, 'user-1', mockReq, admin);
      expect(result.name).toBe('Updated');
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────
  describe('softDelete', () => {
    it('should throw NotFoundError when district does not exist', async () => {
      prismaMock.district.findUnique.mockResolvedValue(null);
      await expect(service.softDelete('d-999', 'user-1', mockReq, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should soft delete district', async () => {
      prismaMock.district.findUnique.mockResolvedValue({ id: 'd-1' } as any);
      prismaMock.district.update.mockResolvedValue({} as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);
      await expect(service.softDelete('d-1', 'user-1', mockReq, admin)).resolves.toBeUndefined();
    });
  });
});
