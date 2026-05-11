import { NextFunction, Request, Response } from 'express';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/response.util';
import type { CreateRegionDto, UpdateRegionDto } from './regions.validation';
import { regionsService } from './regions.service';

export async function listRegions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { search, status, hasCoordinates, sortBy, sortOrder } = req.query as Record<string, string>;
    const result = await regionsService.list(req.pagination!, { search, status, hasCoordinates, sortBy, sortOrder }, req.user!);
    sendPaginated(res, result.data, result.pagination);
  } catch (err) {
    next(err);
  }
}

export async function getRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await regionsService.findById(req.params['id']!, req.user!));
  } catch (err) {
    next(err);
  }
}

export async function createRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendCreated(res, await regionsService.create(req.body as CreateRegionDto, req.user!.id, req, req.user!), 'Region creee');
  } catch (err) {
    next(err);
  }
}

export async function updateRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(
      res,
      await regionsService.update(req.params['id']!, req.body as UpdateRegionDto, req.user!.id, req, req.user!),
      'Region mise a jour',
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteRegion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await regionsService.softDelete(req.params['id']!, req.user!.id, req, req.user!);
    sendSuccess(res, null, 'Region supprimee');
  } catch (err) {
    next(err);
  }
}
