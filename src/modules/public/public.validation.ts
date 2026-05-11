import { z } from 'zod';

export const signupSchema = z.object({
  firstName: z.string().min(1, 'Prenom requis').max(60),
  lastName: z.string().min(1, 'Nom requis').max(60),
  email: z.string().email('Email invalide').transform((value) => value.toLowerCase()),
  password: z.string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caracteres')
    .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
    .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
  organizationName: z.string().min(2, 'Nom de l organisation requis').max(120),
  assemblyName: z.string().min(2, 'Nom de la premiere assemblee requis').max(120),
  country: z.string().max(80).optional(),
  currency: z.string().min(3).max(3).optional(),
  language: z.string().min(2).max(8).optional(),
  timezone: z.string().min(2).max(80).optional(),
  phone: z.string().max(20).optional().nullable(),
}).strict();

export type SignupDto = z.infer<typeof signupSchema>;
