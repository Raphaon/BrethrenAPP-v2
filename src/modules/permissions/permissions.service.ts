import { prisma } from '../../database/prisma';

export class PermissionsService {
  async list(module?: string) {
    return prisma.permission.findMany({
      where: module ? { module } : undefined,
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }

  async findById(id: string) {
    return prisma.permission.findUnique({ where: { id } });
  }

  async listModules(): Promise<string[]> {
    const perms = await prisma.permission.findMany({
      select: { module: true },
      distinct: ['module'],
      orderBy: { module: 'asc' },
    });
    return perms.map((p) => p.module);
  }
}

export const permissionsService = new PermissionsService();
