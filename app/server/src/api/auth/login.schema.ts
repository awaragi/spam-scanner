import { z } from 'zod';

/** Body shape for `POST /auth/login` (design.md D3): just the admin password. */
export const loginSchema = z.object({
  password: z.string(),
});

export type LoginBody = z.infer<typeof loginSchema>;
