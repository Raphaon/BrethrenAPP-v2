import { RegionsService } from '../../src/modules/regions/regions.service';
import { prismaMock } from '../helpers/test-setup';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../src/utils/scope-access.util', () => ({
  assertRegionAccess: jest.fn().mockResolvedValue(undefined),
  getActorScope: jest.fn().mockResolvedValue({ kind: 'platform' }),
}));
jest.mock('../../src/middlewares/rbac.middleware', () => ({
  isNationalAdmin: jest.fn().mockReturnValue(true),
}));
jest.mock('../../src/services/plan-limit.service', () => ({
  planLimitService: { assertCanCreateRegion: jest.fn().mockResolvedValue(undefined) },
}));

import { isNationalAdmin } from '../../src/middlewares/rbac.middleware';

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const nationalAdmin = {
  id: 'user-1', tenantId: 'tenant-1',
  email: 'admin@test.com', firstName: 'Admin', lastName: 'Test',
  status: 'ACTIVE',
  roles: [{ role: { name: 'super_admin', level: 1, rolePermissions: [] }, regionId: null, districtId: null, assemblyId: null, ministryId: null }],
} as unknown as AuthUser;

const pagination = { page: 1, limit: 25, skip: 0 };

describe('RegionsService', () => {
  let service: RegionsService;

  beforeEach(() => {
    service = new RegionsService();
    (isNationalAdmin as jest.Mock).mockReturnValue(true);
  });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('should return paginated regions', async () => {
      const mockRegions = [{ id: 'r-1', name: 'Region Centre', code: 'RC', _count: { districts: 3 } }];
      prismaMock.$transaction.mockResolvedValue([mockRegions, 1] as any);

      const result = await service.list(pagination, {}, nationalAdmin);
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should return empty list when no regions', async () => {
      prismaMock.$transaction.mockResolvedValue([[], 0] as any);
      const result = await service.list(pagination, {}, nationalAdmin);
      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('should return region when found', async () => {
      const mockRegion = { id: 'r-1', name: 'Region Centre', districts: [], _count: { districts: 0 } };
      prismaMock.region.findUnique.mockResolvedValue(mockRegion as any);

      const result = await service.findById('r-1', nationalAdmin);
      expect(result.id).toBe('r-1');
    });

    it('should throw NotFoundError when region does not exist', async () => {
      prismaMock.region.findUnique.mockResolvedValue(null);
      await expect(service.findById('r-999', nationalAdmin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should create a region successfully', async () => {
      prismaMock.region.findFirst.mockResolvedValue(null);
      prismaMock.region.create.mockResolvedValue({ id: 'r-2', name: 'Region Littoral', _count: { districts: 0 } } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.create({ name: 'Region Littoral', code: 'RL', status: 'ACTIVE' as const }, 'user-1', mockReq, nationalAdmin);
      expect(result.id).toBe('r-2');
    });

    it('should throw when plan limit blocks region creation', async () => {
      const { planLimitService } = jest.requireMock('../../src/services/plan-limit.service');
      planLimitService.assertCanCreateRegion.mockRejectedValueOnce(
        Object.assign(new Error('Limite'), { code: 'PLAN_LIMIT_REACHED', statusCode: 402 })
      );
      prismaMock.region.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Region Test', status: 'ACTIVE' as const }, 'user-2', mockReq, nationalAdmin)
      ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    });

    it('should throw ConflictError when region name already exists', async () => {
      prismaMock.region.findFirst.mockResolvedValue({ id: 'r-1', name: 'Region Centre' } as any);
      await expect(
        service.create({ name: 'Region Centre', status: 'ACTIVE' as const }, 'user-1', mockReq, nationalAdmin)
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should update region successfully', async () => {
      const existing = { id: 'r-1', name: 'Old Name' };
      prismaMock.region.findUnique.mockResolvedValue(existing as any);
      prismaMock.region.update.mockResolvedValue({ id: 'r-1', name: 'New Name', _count: { districts: 0 } } as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await service.update('r-1', { name: 'New Name' }, 'user-1', mockReq, nationalAdmin);
      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundError when region does not exist', async () => {
      prismaMock.region.findUnique.mockResolvedValue(null);
      await expect(service.update('r-999', { name: 'X' }, 'user-1', mockReq, nationalAdmin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────
  describe('softDelete', () => {
    it('should soft delete region', async () => {
      prismaMock.region.findUnique.mockResolvedValue({ id: 'r-1' } as any);
      prismaMock.region.update.mockResolvedValue({} as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);
      await expect(service.softDelete('r-1', 'user-1', mockReq, nationalAdmin)).resolves.toBeUndefined();
    });

    it('should throw NotFoundError when region not found', async () => {
      prismaMock.region.findUnique.mockResolvedValue(null);
      await expect(service.softDelete('r-999', 'user-1', mockReq, nationalAdmin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
