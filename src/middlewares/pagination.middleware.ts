import { Request, Response, NextFunction } from 'express';
import { parsePagination } from '../utils/pagination.util';

export function paginationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.pagination = parsePagination(req);
  next();
}
