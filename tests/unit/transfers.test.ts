import { TransfersService } from '../../src/modules/transfers/transfers.service';
import { prismaMock } from '../helpers/test-setup';
import { AppError } from '../../src/middlewares/error.middleware';
import { Request } from 'express';
import type { AuthUser } from '../../src/shared/types/express';

jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;
const mockUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'user@test.local',
  firstName: 'Test',
  lastName: 'User',
  status: 'ACTIVE',
  roles: [
    {
      role: {
        id: 'role-1',
        name: 'super_admin',
        displayName: 'Super Admin',
        level: 1,
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        rolePermissions: [],
      },
      tenantId: null,
      regionId: null,
      districtId: null,
      assemblyId: null,
      ministryId: null,
    },
  ],
} satisfies AuthUser;

describe('TransfersService', () => {
  let transfersService: TransfersService;

  beforeEach(() => {
    transfersService = new TransfersService();
  });

  describe('create', () => {
    it('should throw when member not found', async () => {
      prismaMock.member.findUnique.mockResolvedValue(null);

      await expect(
        transfersService.create(
          { memberId: 'mem-1', toAssemblyId: 'asm-2', reason: 'Déménagement' },
          mockUser,
          mockReq
        )
      ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
    });

    it('should throw SAME_ASSEMBLY when member already in target assembly', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'mem-1',
        assemblyId: 'asm-1',
        status: 'ACTIVE',
        assembly: { id: 'asm-1' },
      } as any);
      prismaMock.assembly.findUnique.mockResolvedValue({ id: 'asm-1' } as any);

      await expect(
        transfersService.create(
          { memberId: 'mem-1', toAssemblyId: 'asm-1', reason: 'Test' },
          mockUser,
          mockReq
        )
      ).rejects.toMatchObject({ code: 'SAME_ASSEMBLY' });
    });

    it('should throw PENDING_TRANSFER_EXISTS when transfer is already pending', async () => {
      prismaMock.member.findUnique.mockResolvedValue({
        id: 'mem-1', assemblyId: 'asm-1', status: 'ACTIVE',
      } as any);
      prismaMock.assembly.findUnique.mockResolvedValue({ id: 'asm-2' } as any);
      prismaMock.transfer.findFirst.mockResolvedValue({ id: 'tr-1', status: 'PENDING' } as any);

      await expect(
        transfersService.create(
          { memberId: 'mem-1', toAssemblyId: 'asm-2', reason: 'Test' },
          mockUser,
          mockReq
        )
      ).rejects.toMatchObject({ code: 'PENDING_TRANSFER_EXISTS' });
    });
  });

  describe('approve', () => {
    it('should throw INVALID_STATUS when transfer is not PENDING', async () => {
      prismaMock.transfer.findUnique.mockResolvedValue({
        id: 'tr-1',
        status: 'APPROVED',
        member: { id: 'mem-1' },
      } as any);

      await expect(
        transfersService.approve('tr-1', 'user-1', mockReq)
      ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });
  });
});
