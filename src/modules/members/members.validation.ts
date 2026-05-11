import { z } from 'zod';
import { flexDateOptional, optionalEmail } from '../../utils/zod.util';

export const createMemberSchema = z.object({
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  gender: z.enum(['MALE', 'FEMALE']),
  birthDate: flexDateOptional,
  birthPlace: z.string().optional(),
  phone: z.string().optional(),
  email: optionalEmail,
  address: z.string().optional(),
  photo: z.string().url().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'DECEASED', 'EXCLUDED']).default('ACTIVE'),
  assemblyId: z.string().uuid('UUID d\'assemblée invalide'),
  preachingPointId: z.string().uuid().optional().nullable(),
  salvationDate: flexDateOptional,
  baptismDate: flexDateOptional,
  memberSince: flexDateOptional,
  profession: z.string().optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED']).optional(),
  emergencyContact: z.string().optional(),
  notes: z.string().optional(),
});

export const updateMemberSchema = createMemberSchema.partial().omit({ assemblyId: true }).strict();

export const listMembersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  assemblyId: z.string().uuid().optional(),
  districtId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  ministryId: z.string().uuid().optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'DECEASED', 'EXCLUDED']).optional(),
  maritalStatus: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type CreateMemberDto = z.infer<typeof createMemberSchema>;
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;
