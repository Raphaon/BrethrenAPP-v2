import { Request, Response, NextFunction } from 'express';
import { rolesService } from './roles.service';
import { sendSuccess, sendCreated } from '../../utils/response.util';
import type { CreateRoleDto, UpdateRoleDto } from './roles.service';
import { z } from 'zod';

export async function listRoles(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, await rolesService.list()); } catch (err) { next(err); }
}

export async function getRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, await rolesService.findById(req.params['id']!)); } catch (err) { next(err); }
}

export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendCreated(res, await rolesService.create(req.body as CreateRoleDto), 'Rôle créé'); } catch (err) { next(err); }
}

export async function updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, await rolesService.update(req.params['id']!, req.body as UpdateRoleDto), 'Rôle mis à jour'); } catch (err) { next(err); }
}

export async function deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await rolesService.delete(req.params['id']!); sendSuccess(res, null, 'Rôle supprimé'); } catch (err) { next(err); }
}

export async function syncRolePermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { permissionIds } = z.object({ permissionIds: z.array(z.string().uuid()) }).parse(req.body);
    sendSuccess(res, await rolesService.syncPermissions(req.params['id']!, permissionIds), 'Permissions synchronisées');
  } catch (err) { next(err); }
}
