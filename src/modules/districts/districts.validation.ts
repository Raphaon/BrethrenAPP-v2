import { z } from 'zod';
import { latitudeField, longitudeField } from '../../utils/zod.util';

export const createDistrictSchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  code: z.string().optional(),
  description: z.string().optional(),
  regionId: z.string().uuid('UUID de région invalide'),
  latitude: latitudeField,
  longitude: longitudeField,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  hqAssemblyId: z.string().uuid().optional().nullable(),
});

export const updateDistrictSchema = createDistrictSchema.partial().omit({ regionId: true });

export const listDistrictsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  regionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  hasCoordinates: z.enum(['true', 'false']).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type CreateDistrictDto = z.infer<typeof createDistrictSchema>;
export type UpdateDistrictDto = z.infer<typeof updateDistrictSchema>;
