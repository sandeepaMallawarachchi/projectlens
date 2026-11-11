import { z } from 'zod';
import { AI_PROVIDER_IDS, AI_TASKS } from '@/engine/models/ai';
import { API_SCOPES } from './store/types';

const ref = z.string().trim().min(1).max(200).regex(/^[\w./@-]+$/, 'Invalid ref');
const httpsUrl = z.string().trim().url().max(500);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['github', 'gitlab', 'local']),
  repository: z.string().trim().min(1).max(300),
  ref: ref.optional(),
  accessToken: z.string().trim().min(1).max(500).optional(),
  baseUrl: httpsUrl.optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ref: ref.nullable().optional(),
  /** null removes the stored token. */
  accessToken: z.string().trim().min(1).max(500).nullable().optional(),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const startScanSchema = z.object({
  mode: z.enum(['quick', 'full']).default('full'),
  ref: ref.optional(),
  force: z.boolean().default(false),
  wait: z.boolean().default(false),
  callbackUrl: httpsUrl.optional()
});

export const aiRequestSchema = z.object({
  task: z.enum(AI_TASKS),
  provider: z.enum(AI_PROVIDER_IDS).optional(),
  model: z.string().min(1).max(200).regex(/^[\w./:-]+$/).optional(),
  findingId: z.string().max(200).optional(),
  moduleId: z.string().max(200).optional(),
  file: z
    .string()
    .max(500)
    .refine((p) => !p.split(/[\\/]/).includes('..') && !p.startsWith('/'), 'File must be a repository-relative path')
    .optional()
});

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(['read'])
});

export function intParam(url: URL, name: string, fallback: number, max: number): number {
  const v = Number(url.searchParams.get(name));
  return Number.isInteger(v) && v > 0 ? Math.min(v, max) : fallback;
}
