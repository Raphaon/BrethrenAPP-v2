import { prisma } from '../../database/prisma';
import { NotFoundError, ConflictError, AppError } from '../../middlewares/error.middleware';
import { z } from 'zod';

export const createRoleSchema = z.object({
  name: z.string().min(2).toLowerCase().regex(/^[a-z_]+$/, 'Nom de rôle: lettres minuscules et underscores uniquement'),
  displayName: z.string().min(2),
  description: z.string().optional(),
  level: z.number().int().min(1).max(5),
  permissionIds: z.array(z.string().uuid()).optional(),
});

export const updateRoleSchema = createRoleSchema.partial().omit({ name: true });

export type CreateRoleDto = z.infer<typeof createRoleSchema>;
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

export class RolesService {
  async list() {
    return prisma.role.findMany({
      include: {
        rolePermissions: {
          include: { permission: { select: { id: true, name: true, module: true, action: true } } },
        },
        _count: { select: { userRoles: true } },
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
      },
    });
    if (!role) throw new NotFoundError('Rôle');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const existing = await prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictError(`Un rôle avec le nom "${dto.name}" existe déjà`);

    return prisma.role.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        level: dto.level,
        ...(dto.permissionIds?.length && {
          rolePermissions: {
            create: dto.permissionIds.map((permissionId) => ({ permissionId })),
          },
        }),
      },
      include: {
        rolePermissions: { include: { permission: true } },
      },
    });
  }

  async update(id: string, dto: UpdateRoleDto) {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundError('Rôle');
    if (role.isSystem) throw new AppError('Les rôles système ne peuvent pas être modifiés', 403, 'SYSTEM_ROLE');

    return prisma.role.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        description: dto.description,
        level: dto.level,
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
  }

  async delete(id: string) {
    const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { userRoles: true } } } });
    if (!role) throw new NotFoundError('Rôle');
    if (role.isSystem) throw new AppError('Les rôles système ne peuvent pas être supprimés', 403, 'SYSTEM_ROLE');
    if (role._count.userRoles > 0) throw new AppError('Ce rôle est assigné à des utilisateurs', 409, 'ROLE_IN_USE');

    await prisma.role.delete({ where: { id } });
  }

  async syncPermissions(id: string, permissionIds: string[]) {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundError('Rôle');

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    return this.findById(id);
  }
}

export const rolesService = new RolesService();
