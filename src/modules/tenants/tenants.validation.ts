import { z } from 'zod';

export const updateTenantSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  logo: z.string().url().optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  currency: z.string().min(3).max(3).optional(),
  language: z.string().min(2).max(8).optional(),
  timezone: z.string().min(2).max(80).optional(),
}).strict();

export const updateTenantSettingsSchema = z.object({
  dateFormat: z.string().max(40).optional(),
  phoneFormat: z.string().max(40).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notificationPreferences: z.record(z.unknown()).optional(),
  onboardingChecklist: z.record(z.unknown()).optional(),
}).strict();

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
export type UpdateTenantSettingsDto = z.infer<typeof updateTenantSettingsSchema>;
