import { z } from 'zod';
import { latitudeField, longitudeField, optionalEmail, flexDateOptional } from '../../utils/zod.util';

export const createAssemblySchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  code: z.string().optional(),
  address: z.string().optional(),
  districtId: z.string().uuid('UUID de district invalide'),
  latitude: latitudeField,
  longitude: longitudeField,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  phone: z.string().optional(),
  email: optionalEmail,
  foundedAt: flexDateOptional,
});

export const updateAssemblySchema = createAssemblySchema.partial().omit({ districtId: true });

export const listAssembliesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  districtId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  hasCoordinates: z.enum(['true', 'false']).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type CreateAssemblyDto = z.infer<typeof createAssemblySchema>;
export type UpdateAssemblyDto = z.infer<typeof updateAssemblySchema>;
