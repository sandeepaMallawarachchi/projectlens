import { describe, expect, it } from 'vitest';
import { scanFixture } from './helpers';
import { normalizeModuleKey, nextRouteSegments, routeMatches, singularize } from '../../src/analyzers/progress/progressEstimator';
import { parseRequirements, weightedCompletion, evaluateRequirements } from '../../src/analyzers/progress/requirements';
import type { FunctionalModule } from '../../src/models/types';

describe('progress estimation', () => {
  it('identifies partial modules with evidence in the partial SaaS fixture', async () => {
    const r = await scanFixture('partial-saas');
    const mods = Object.fromEntries(r.progress.modules.map((m) => [m.id, m]));
    expect(mods.billing.status).toBe('partial');
    expect(mods.billing.evidence.some((e) => e.kind === 'missing-endpoint' && /\/api\/billing\/invoices/.test(e.detail))).toBe(true);
    expect(mods.billing.evidence.some((e) => e.kind === 'placeholder' && /Not implemented/i.test(e.detail))).toBe(true);
    expect(mods.dashboard.status).toBe('partial');
    expect(mods.dashboard.evidence.some((e) => e.kind === 'mock-data')).toBe(true);
    expect(mods.settings.status).toBe('partial');
    expect(mods.dashboard.layers).toMatchObject({ ui: true, api: true });
    expect(r.progress.placeholders.some((p) => p.kind === 'todo')).toBe(true);
    expect(r.progress.placeholders.some((p) => p.kind === 'fixme')).toBe(true);
  });

  it('computes weighted requirements completion from .projectlens.json', async () => {
    const r = await scanFixture('partial-saas');
    const req = r.progress.requirements!;
    expect(req).toBeDefined();
    const byId = Object.fromEntries(req.results.map((x) => [x.feature.id, x]));
    expect(byId.auth.status).toBe('not-detected');
    expect(byId.auth.completion).toBe(0);
    const expected = Math.round(req.results.reduce((s, x) => s + x.feature.weight * x.completion, 0) / req.results.reduce((s, x) => s + x.feature.weight, 0));
    expect(req.weightedCompletion).toBe(expected);
    expect(r.scores.implementation.label).toBe('Requirements Completion');
    expect(r.scores.implementation.score).toBe(expected);
  });

  it('reports implementation evidence (not requirements) when no requirements file exists', async () => {
    const r = await scanFixture('healthy-nextjs');
    expect(r.progress.requirements).toBeUndefined();
    expect(r.scores.implementation.label).toBe('Implementation Evidence');
    expect(r.progress.modules.find((m) => m.id === 'post')?.status).toBe('implemented');
    expect(r.progress.limitations.length).toBeGreaterThan(0);
  });

  it('labels quick-scan progress as structure-only', async () => {
    const r = await scanFixture('partial-saas', 'quick');
    expect(r.progress.limitations[0]).toMatch(/Quick Scan/);
  });

  it('normalizes module keys and route paths', () => {
    expect(normalizeModuleKey('UserService.ts')).toBe('user');
    expect(normalizeModuleKey('billingController')).toBe('billing');
    expect(normalizeModuleKey('login')).toBe('auth');
    expect(normalizeModuleKey('settings')).toBe('settings');
    expect(normalizeModuleKey('[id]')).toBeNull();
    expect(normalizeModuleKey('utils')).toBeNull();
    expect(singularize('categories')).toBe('category');
    expect(nextRouteSegments('app/(marketing)/pricing/page.tsx')).toEqual({ segments: ['pricing'], kind: 'page' });
    expect(nextRouteSegments('src/app/api/users/[id]/route.ts')).toEqual({ segments: ['api', 'users', '[id]'], kind: 'api-route' });
    expect(nextRouteSegments('pages/api/hello.ts')).toEqual({ segments: ['api', 'hello'], kind: 'api-route' });
    expect(routeMatches('/api/users/:param', '/api/users/:param', false)).toBe(true);
    expect(routeMatches('/api/users/42', '/api/users/[id]', false)).toBe(true);
    expect(routeMatches('/api/users', '/api/posts', false)).toBe(false);
    expect(routeMatches('/api/v1/users', '/users', true)).toBe(true);
  });
});

describe('requirements file', () => {
  it('validates the schema and reports errors', () => {
    expect(parseRequirements('{ "features": [{ "id": "a", "name": "A", "weight": 2 }] }').features).toHaveLength(1);
    expect(parseRequirements('{ "features": [{ "id": "a", "name": "A", "weight": 2 }] }').features[0].weight).toBe(2);
    expect(parseRequirements('{ "features": [{ "id": "a", "name": "A" }] }').features[0].weight).toBe(1);
    expect(parseRequirements('{ "features": [] }').errors.length).toBeGreaterThan(0);
    expect(parseRequirements('{ "features": [{ "id": "a", "name": "A", "weight": -1 }] }').errors.length).toBeGreaterThan(0);
    expect(parseRequirements('not json').errors[0]).toMatch(/Invalid JSON/);
  });

  it('implements Σ(weight × completion) / Σ(weight)', () => {
    expect(weightedCompletion([{ weight: 3, completion: 100 }, { weight: 1, completion: 0 }])).toBe(75);
    expect(weightedCompletion([])).toBe(0);
  });

  it('matches features by keyword and path', () => {
    const mod = (id: string, completion: number): FunctionalModule => ({ id, name: id, status: 'partial', completion, layers: { ui: true, api: false, data: false, tests: false }, fileCount: 1, evidence: [], reasons: [] });
    const results = evaluateRequirements(
      [
        { id: 'auth', name: 'Auth', weight: 1, match: ['auth'] },
        { id: 'admin', name: 'Admin', weight: 1, paths: ['app/admin/**'] },
        { id: 'missing', name: 'Missing', weight: 1 }
      ],
      [mod('auth', 80), mod('panel', 50)],
      new Map([['panel', ['app/admin/page.tsx']]])
    );
    expect(results.map((r) => [r.feature.id, r.status, r.completion])).toEqual([
      ['auth', 'partial', 80],
      ['admin', 'partial', 50],
      ['missing', 'not-detected', 0]
    ]);
  });
});
