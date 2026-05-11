import { Request } from 'express';
import { config } from '../config';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
  const limit = Math.min(
    config.MAX_PAGE_SIZE,
    Math.max(1, parseInt(req.query['limit'] as string) || config.DEFAULT_PAGE_SIZE)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function parseSort(
  req: Request,
  allowedFields: string[],
  defaultField = 'createdAt',
  defaultOrder: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> {
  const sortBy = req.query['sortBy'] as string;
  const sortOrder = (req.query['sortOrder'] as string) === 'asc' ? 'asc' : 'desc';

  if (sortBy && allowedFields.includes(sortBy)) {
    return { [sortBy]: sortOrder };
  }
  return { [defaultField]: defaultOrder };
}
