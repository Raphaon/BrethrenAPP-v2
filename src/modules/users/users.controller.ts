import { Request, Response, NextFunction } from 'express';
import { usersService } from './users.service';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.util';
import type { CreateUserDto, UpdateUserDto, AssignRoleDto, SelfUpdateDto } from './users.validation';

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, status, roleId, sortBy, sortOrder } = req.query as Record<string, string>;
    const result = await usersService.list(
      req.pagination!,
      { search, status, roleId, sortBy, sortOrder: sortOrder as 'asc' | 'desc' },
      req.user!,
    );
    sendPaginated(res, result.data, result.pagination);
  } catch (err) {
    next(err);
  }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.findById(req.params['id']!, req.user!);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.create(req.body as CreateUserDto, req.user!.id, req, req.user!);
    sendCreated(res, user, 'Utilisateur cree avec succes');
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.update(req.params['id']!, req.body as UpdateUserDto, req.user!.id, req, req.user!);
    sendSuccess(res, user, 'Utilisateur mis a jour');
  } catch (err) {
    next(err);
  }
}

export async function getSelf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.findById(req.user!.id, req.user!);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateSelf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.update(req.user!.id, req.body as SelfUpdateDto, req.user!.id, req, req.user!);
    sendSuccess(res, user, 'Profil mis a jour');
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await usersService.softDelete(req.params['id']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'Utilisateur supprime');
  } catch (err) {
    next(err);
  }
}

export async function activateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.toggleStatus(req.params['id']!, 'ACTIVE', req.user!.id, req, req.user!);
    sendSuccess(res, user, 'Compte active');
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.toggleStatus(req.params['id']!, 'INACTIVE', req.user!.id, req, req.user!);
    sendSuccess(res, user, 'Compte desactive');
  } catch (err) {
    next(err);
  }
}

export async function assignRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userRole = await usersService.assignRole(req.params['id']!, req.body as AssignRoleDto, req.user!.id, req, req.user!);
    sendCreated(res, userRole, 'Role assigne');
  } catch (err) {
    next(err);
  }
}

export async function removeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await usersService.removeRole(req.params['id']!, req.params['roleId']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'Role retire');
  } catch (err) {
    next(err);
  }
}
