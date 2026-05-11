import { Request, Response, NextFunction } from 'express';
import { membersService } from './members.service';
import { sendSuccess, sendCreated, sendPaginated } from '../../utils/response.util';
import type { CreateMemberDto, UpdateMemberDto } from './members.validation';

export async function listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const f = req.query as Record<string, string>;
    const result = await membersService.list(req.pagination!, f, req.user!);
    sendPaginated(res, result.data, result.pagination);
  } catch (err) { next(err); }
}

export async function getMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await membersService.findById(req.params['id']!, req.user!);
    sendSuccess(res, member);
  } catch (err) { next(err); }
}

export async function createMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await membersService.create(req.body as CreateMemberDto, req.user!.id, req, req.user!);
    sendCreated(res, member, 'Membre créé avec succès');
  } catch (err) { next(err); }
}

export async function updateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await membersService.update(req.params['id']!, req.body as UpdateMemberDto, req.user!.id, req, req.user!);
    sendSuccess(res, member, 'Membre mis à jour');
  } catch (err) { next(err); }
}

export async function deleteMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await membersService.softDelete(req.params['id']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'Membre supprimé');
  } catch (err) { next(err); }
}

export async function getMemberHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const history = await membersService.getHistory(req.params['id']!);
    sendSuccess(res, history);
  } catch (err) { next(err); }
}
