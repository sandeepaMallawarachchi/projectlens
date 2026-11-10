import { z } from 'zod';
import ignore from 'ignore';
import type { FunctionalModule, ModuleStatus, RequirementFeature, RequirementResult } from '../../models/types';

export const REQUIREMENTS_FILE = '.projectlens.json';

export const requirementsSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1).optional(),
  features: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().min(1).max(160),
        weight: z.number().positive().max(1000).default(1),
        description: z.string().max(1000).optional(),
        match: z.array(z.string().min(1).max(80)).max(50).optional(),
        paths: z.array(z.string().min(1).max(300)).max(50).optional()
      })
    )
    .min(1)
    .max(200)
});

export function parseRequirements(text: string): { features: RequirementFeature[]; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { features: [], errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const parsed = requirementsSchema.safeParse(json);
  if (!parsed.success) {
    return { features: [], errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  return { features: parsed.data.features, errors: [] };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Σ(feature weight × estimated completion) / Σ(feature weights) */
export function weightedCompletion(results: { weight: number; completion: number }[]): number {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  return Math.round(results.reduce((s, r) => s + r.weight * r.completion, 0) / totalWeight);
}

export function statusFor(completion: number, matched: boolean): ModuleStatus {
  if (!matched || completion === 0) {
    return 'not-detected';
  }
  return completion >= 85 ? 'implemented' : 'partial';
}

export function evaluateRequirements(
  features: RequirementFeature[],
  modules: FunctionalModule[],
  moduleFiles: Map<string, string[]>
): RequirementResult[] {
  return features.map((feature) => {
    const keywords = (feature.match?.length ? feature.match : [feature.id, feature.name]).map(norm).filter(Boolean);
    const pathMatcher = feature.paths?.length ? ignore().add(feature.paths) : null;
    const matched = modules.filter((m) => {
      const key = norm(m.id);
      const name = norm(m.name);
      if (keywords.some((k) => k === key || k === name || (k.length >= 4 && (key.includes(k) || k.includes(key) && key.length >= 4)))) {
        return true;
      }
      if (pathMatcher) {
        return (moduleFiles.get(m.id) ?? []).some((f) => {
          try {
            return pathMatcher.ignores(f);
          } catch {
            return false;
          }
        });
      }
      return false;
    });
    const completion = matched.length ? Math.round(matched.reduce((s, m) => s + m.completion, 0) / matched.length) : 0;
    return {
      feature,
      status: statusFor(completion, matched.length > 0),
      completion,
      matchedModules: matched.map((m) => m.id)
    };
  });
}

export const REQUIREMENTS_TEMPLATE = {
  $schema: 'https://projectlens.dev/schema/requirements-v1.json',
  version: 1,
  features: [
    { id: 'auth', name: 'Authentication', weight: 3, match: ['auth', 'login', 'signup'], description: 'Sign up, sign in, sign out, password reset' },
    { id: 'dashboard', name: 'Dashboard', weight: 2, match: ['dashboard'] },
    { id: 'billing', name: 'Billing & subscriptions', weight: 2, match: ['billing', 'subscription', 'checkout'] },
    { id: 'settings', name: 'User settings', weight: 1, match: ['settings', 'profile', 'account'] }
  ]
};
