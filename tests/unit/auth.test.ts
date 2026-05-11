import { AuthService } from '../../src/modules/auth/auth.service';
import { prismaMock } from '../helpers/test-setup';
import * as passwordUtil from '../../src/utils/password.util';
import * as jwtUtil from '../../src/utils/jwt.util';
import { AppError } from '../../src/middlewares/error.middleware';
import { Request } from 'express';

jest.mock('../../src/utils/password.util');
jest.mock('../../src/utils/jwt.util');
jest.mock('../../src/utils/audit.util', () => ({ createAuditLog: jest.fn() }));

const mockReq = { ip: '127.0.0.1', get: () => 'jest-agent' } as unknown as Request;

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('login', () => {
    it('should throw INVALID_CREDENTIALS when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'notfound@test.com', password: 'test' }, mockReq)
      ).rejects.toThrow(AppError);

      await expect(
        authService.login({ email: 'notfound@test.com', password: 'test' }, mockReq)
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('should throw ACCOUNT_SUSPENDED when account is suspended', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        status: 'SUSPENDED',
        member: null,
        userRoles: [],
      } as any);

      await expect(
        authService.login({ email: 'test@test.com', password: 'test' }, mockReq)
      ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    });

    it('should throw INVALID_CREDENTIALS when password is wrong', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        status: 'ACTIVE',
        member: null,
        userRoles: [],
      } as any);

      (passwordUtil.verifyPassword as jest.Mock).mockResolvedValue(false);

      prismaMock.auditLog.create.mockResolvedValue({} as any);

      await expect(
        authService.login({ email: 'test@test.com', password: 'wrongpass' }, mockReq)
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('should throw MEMBER_INACTIVE when linked member is transferred', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        status: 'ACTIVE',
        member: {
          status: 'TRANSFERRED',
          deletedAt: null,
        },
        userRoles: [],
      } as any);

      await expect(
        authService.login({ email: 'test@test.com', password: 'correct' }, mockReq)
      ).rejects.toMatchObject({ code: 'MEMBER_INACTIVE' });
    });

    it('should return tokens on successful login', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        password: 'hashed',
        firstName: 'Test',
        lastName: 'User',
        status: 'ACTIVE',
        member: null,
        userRoles: [],
      };

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any);
      (passwordUtil.verifyPassword as jest.Mock).mockResolvedValue(true);
      (jwtUtil.signAccessToken as jest.Mock).mockReturnValue('mock_access_token');
      (jwtUtil.signRefreshToken as jest.Mock).mockReturnValue('mock_refresh_token');
      (jwtUtil.getRefreshTokenExpiryDate as jest.Mock).mockReturnValue(new Date());

      prismaMock.refreshToken.create.mockResolvedValue({ id: 'rt-1' } as any);
      prismaMock.user.update.mockResolvedValue(mockUser as any);
      prismaMock.auditLog.create.mockResolvedValue({} as any);

      const result = await authService.login({ email: 'test@test.com', password: 'correct' }, mockReq);

      expect(result.accessToken).toBe('mock_access_token');
      expect(result.refreshToken).toBe('mock_refresh_token');
      expect(result.user.id).toBe('user-1');
      expect(result.user.roles).toEqual([]);
    });
  });

  describe('changePassword', () => {
    it('should throw WRONG_PASSWORD when current password is incorrect', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', password: 'hashed' } as any);
      (passwordUtil.verifyPassword as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.changePassword(
          'user-1',
          { currentPassword: 'wrong', newPassword: 'New@12345', confirmPassword: 'New@12345' },
          mockReq
        )
      ).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    });
  });
});
