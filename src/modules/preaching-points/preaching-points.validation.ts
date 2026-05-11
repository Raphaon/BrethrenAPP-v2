import { z } from 'zod';
import { latitudeField, longitudeField, flexDateOptional } from '../../utils/zod.util';

export const createPreachingPointSchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  address: z.string().optional(),
  assemblyId: z.string().uuid('UUID d\'assemblée invalide'),
  latitude: latitudeField,
  longitude: longitudeField,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  leaderId: z.string().uuid().optional().nullable(),
  phone: z.string().optional(),
  foundedAt: flexDateOptional,
});

export const updatePreachingPointSchema = createPreachingPointSchema.partial().omit({ assemblyId: true }).strict();

export type CreatePreachingPointDto = z.infer<typeof createPreachingPointSchema>;
export type UpdatePreachingPointDto = z.infer<typeof updatePreachingPointSchema>;
