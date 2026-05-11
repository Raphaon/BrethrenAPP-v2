import { z } from 'zod';
import { flexDateOptional } from '../../utils/zod.util';

export const createUserSchema = z.object({
  email: z.string().email('Email invalide').toLowerCase(),
  phone: z.string().optional(),
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  password: z
    .string()
    .min(8, 'Mot de passe minimum 8 caractères')
    .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
    .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED']).default('ACTIVE'),
  memberId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().toLowerCase().optional(),
  phone: z.string().optional().nullable(),
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  avatar: z.preprocess((v) => (v === '' ? null : v), z.string().url().optional().nullable()),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED']).optional(),
});

export const assignRoleSchema = z.object({
  roleId: z.string().uuid('UUID de rôle invalide'),
  regionId: z.string().uuid().optional().nullable(),
  districtId: z.string().uuid().optional().nullable(),
  assemblyId: z.string().uuid().optional().nullable(),
  ministryId: z.string().uuid().optional().nullable(),
  expiresAt: flexDateOptional,
});

export const listUsersQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED']).optional(),
  roleId: z.string().uuid().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// Mise à jour du profil propre (tout utilisateur authentifié)
export const selfUpdateSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  avatar: z.preprocess((v) => (v === '' ? null : v), z.string().url().optional().nullable()),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type SelfUpdateDto = z.infer<typeof selfUpdateSchema>;
export type AssignRoleDto = z.infer<typeof assignRoleSchema>;
