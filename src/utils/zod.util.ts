import { z } from 'zod';

const parseFlexDate = (val: string, ctx: z.RefinementCtx): string => {
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Format de date invalide' });
    return z.NEVER;
  }
  return d.toISOString();
};

export const flexDate = z.string().min(1).transform(parseFlexDate);

export const flexDateOptional = z.preprocess(
  (v) => (v === '' ? null : v),
  z.union([z.string().transform(parseFlexDate), z.null()]).optional(),
);

export const latitudeField = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v === null ? null : Number(v)),
  z.number().min(-90).max(90).nullable().optional(),
);

export const longitudeField = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v === null ? null : Number(v)),
  z.number().min(-180).max(180).nullable().optional(),
);

export const optionalEmail = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().email().optional(),
);
