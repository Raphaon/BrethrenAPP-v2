import { z } from 'zod';
import { latitudeField, longitudeField } from '../../utils/zod.util';

export const createRegionSchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  code: z.string().optional(),
  description: z.string().optional(),
  latitude: latitudeField,
  longitude: longitudeField,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  hqAssemblyId: z.string().uuid().optional().nullable(),
});

export const updateRegionSchema = createRegionSchema.partial();

export const listRegionsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  hasCoordinates: z.enum(['true', 'false']).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type CreateRegionDto = z.infer<typeof createRegionSchema>;
export type UpdateRegionDto = z.infer<typeof updateRegionSchema>;
