import { RolesService } from '../../src/modules/roles/roles.service';
import { prismaMock } from '../helpers/test-setup';

const mockRole = {
  id: 'role-1', name: 'responsable_assemblee', displayName: 'Responsable Assemblée',
  description: 'Gère une assemblée', level: 3, isSystem: false,
  rolePermissions: [], _count: { userRoles: 0 },
};

describe('RolesService', () => {
  let service: RolesService;
  beforeEach(() => { service = new RolesService(); });

  // ─── list ──────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('should return all roles ordered by level', async () => {
      prismaMock.role.findMany.mockResolvedValue([mockRole] as any);
      const result = await service.list();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('responsable_assemblee');
    });

    it('should return empty array when no roles', async () => {
      prismaMock.role.findMany.mockResolvedValue([] as any);
      const result = await service.list();
      expect(result).toHaveLength(0);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────────
  describe('findById', () => {
    it('should return role with permissions', async () => {
      prismaMock.role.findUnique.mockResolvedValue(mockRole as any);
      const result = await service.findById('role-1');
      expect(result.id).toBe('role-1');
    });

    it('should throw NotFoundError when role does not exist', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.findById('role-999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('should throw ConflictError when role name already exists', async () => {
      prismaMock.role.findUnique.mockResolvedValue(mockRole as any);
      await expect(
        service.create({ name: 'responsable_assemblee', displayName: 'Test', level: 3 })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should create role without permissions', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      prismaMock.role.create.mockResolvedValue({ ...mockRole, id: 'role-new' } as any);

      const result = await service.create({ name: 'new_role', displayName: 'New Role', level: 4 });
      expect(result.id).toBe('role-new');
    });

    it('should create role with permissions', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      prismaMock.role.create.mockResolvedValue({
        ...mockRole, id: 'role-new',
        rolePermissions: [{ permissionId: 'perm-1', permission: { id: 'perm-1', name: 'MEMBERS_READ', module: 'members', action: 'read' } }],
      } as any);

      const result = await service.create({
        name: 'new_role', displayName: 'New Role', level: 4,
        permissionIds: ['perm-1'],
      });
      expect(result.rolePermissions).toHaveLength(1);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('should throw NotFoundError when role does not exist', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.update('role-999', { displayName: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw SYSTEM_ROLE error when trying to update system role', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ ...mockRole, isSystem: true } as any);
      await expect(service.update('role-1', { displayName: 'Hacked' })).rejects.toMatchObject({ code: 'SYSTEM_ROLE' });
    });

    it('should update role successfully', async () => {
      prismaMock.role.findUnique.mockResolvedValue(mockRole as any);
      prismaMock.role.update.mockResolvedValue({ ...mockRole, displayName: 'Updated Display' } as any);

      const result = await service.update('role-1', { displayName: 'Updated Display' });
      expect(result.displayName).toBe('Updated Display');
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('should throw NotFoundError when role does not exist', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.delete('role-999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should throw SYSTEM_ROLE error when trying to delete system role', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ ...mockRole, isSystem: true, _count: { userRoles: 0 } } as any);
      await expect(service.delete('role-1')).rejects.toMatchObject({ code: 'SYSTEM_ROLE' });
    });

    it('should throw ROLE_IN_USE when role has assigned users', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ ...mockRole, _count: { userRoles: 5 } } as any);
      await expect(service.delete('role-1')).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
    });

    it('should delete role when no users assigned', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ ...mockRole, _count: { userRoles: 0 } } as any);
      prismaMock.role.delete.mockResolvedValue(mockRole as any);
      await expect(service.delete('role-1')).resolves.toBeUndefined();
    });
  });

  // ─── syncPermissions ───────────────────────────────────────────────────────
  describe('syncPermissions', () => {
    it('should throw NotFoundError when role does not exist', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.syncPermissions('role-999', ['perm-1'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('should replace all permissions', async () => {
      // First call for existence check, second call inside findById
      prismaMock.role.findUnique
        .mockResolvedValueOnce(mockRole as any)
        .mockResolvedValueOnce({
          ...mockRole,
          rolePermissions: [{ permissionId: 'perm-2', permission: { id: 'perm-2', name: 'PASTORS_READ', module: 'pastors', action: 'read' } }],
        } as any);

      prismaMock.$transaction.mockResolvedValue([{ count: 1 }, { count: 1 }] as any);

      const result = await service.syncPermissions('role-1', ['perm-2']);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(result.rolePermissions).toHaveLength(1);
    });

    it('should clear all permissions when given empty array', async () => {
      prismaMock.role.findUnique
        .mockResolvedValueOnce(mockRole as any)
        .mockResolvedValueOnce({ ...mockRole, rolePermissions: [] } as any);

      prismaMock.$transaction.mockResolvedValue([{ count: 0 }, { count: 0 }] as any);

      const result = await service.syncPermissions('role-1', []);
      expect(result.rolePermissions).toHaveLength(0);
    });
  });
});
