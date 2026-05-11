import { z } from 'zod';

export const createCommentSchema = z
  .object({
    content: z.string().trim().min(2).max(2000),
    parentId: z.string().uuid().optional().nullable(),
  })
  .strict();

export type CreateCommentDto = z.infer<typeof createCommentSchema>;
