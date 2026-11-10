import type { FunctionalModule, ModuleEvidenceItem, PlaceholderLocation, ProgressReport, RequirementFeature } from '../../models/types';
import type { DiscoveredFile } from '../../core/fileDiscovery';
import type { FileRoles } from '../../core/fileContext';
import type { FileFacts } from './facts';
import { evaluateRequirements, weightedCompletion } from './requirements';

export interface ProgressFileInput {
  file: DiscoveredFile;
  roles: FileRoles;
  facts: FileFacts;
}

export interface ProgressInputs {
  files: ProgressFileInput[];
  markerPlaceholders: PlaceholderLocation[];
  requirements?: { file: string; features: RequirementFeature[]; errors: string[] };
  /** Project proxies API calls (Next.js rewrites, Vite proxy) — missing-endpoint checks are skipped. */
  hasApiProxy: boolean;
  hasDatabase: boolean;
}

const GENERIC = new Set([
  '', 'index', 'utils', 'util', 'helpers', 'helper', 'lib', 'common', 'shared', 'types', 'type', 'config', 'constants', 'constant',
  'layout', 'ui', 'components', 'component', 'hooks', 'hook', 'api', 'app', 'src', 'page', 'pages', 'styles', 'assets', 'public',
  'v1', 'v2', 'v3', 'core', 'base', 'main', 'server', 'client', 'middleware', 'db', 'database', 'prisma', 'error', 'not-found',
  'loading', 'globals', 'global', 'context', 'providers', 'provider', 'store', 'test', 'tests', 'mock', 'mocks', 'route', 'routes',
  'trpc', 'graphql', 'health', 'icons', 'icon', 'logo', 'button', 'input', 'modal', 'header', 'footer', 'navbar', 'sidebar', 'nav'
]);

const ALIASES: Record<string, string> = {
  login: 'auth', signin: 'auth', 'sign-in': 'auth', signup: 'auth', 'sign-up': 'auth', register: 'auth', logout: 'auth',
  session: 'auth', 'forgot-password': 'auth', 'reset-password': 'auth', password: 'auth', oauth: 'auth', authentication: 'auth',
  payment: 'billing', checkout: 'billing', subscription: 'billing', invoice: 'billing', stripe: 'billing',
  account: 'settings', preferences: 'settings', setting: 'settings', home: 'home', landing: 'home', product: 'product', cart: 'cart'
};

const DISPLAY_NAMES: Record<string, string> = { auth: 'Authentication', billing: 'Billing & payments', home: 'Home / landing' };

const UNCOUNTABLE = new Set(['settings', 'news', 'analytics', 'status', 'access', 'address', 'business', 'data', 'media', 'series', 'canvas', 'alias', 'sms', 'credentials', 'preferences']);

export function singularize(word: string): string {
  if (word.length <= 3 || UNCOUNTABLE.has(word) || /(ss|us|is|ics)$/.test(word)) {
    return word;
  }
  if (word.endsWith('ies')) {
    return word.slice(0, -3) + 'y';
  }
  if (/(ches|shes|xes)$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

export function normalizeModuleKey(raw: string): string | null {
  let key = raw
    .replace(/\.[\w]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-(service|controller|model|router|routes|route|schema|handler|handlers|repository|repo|slice|store|api|page|view|screen|actions?|queries|mutations|resolver|entity|dto|module)$/, '')
    .replace(/^(use-|get-|create-)/, '');
  if (/^[[(@_]/.test(raw) || !/^[a-z0-9-]+$/.test(key)) {
    return null;
  }
  key = key.split('-').map(singularize).join('-');
  key = ALIASES[key] ?? key;
  return GENERIC.has(key) ? null : key;
}

function displayName(key: string): string {
  return DISPLAY_NAMES[key] ?? key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Route segments of a Next.js file path (route groups, slots and private folders removed). */
export function nextRouteSegments(relPath: string): { segments: string[]; kind: 'page' | 'api-route' } | null {
  const app = /(?:^|\/)(?:src\/)?app\/(.+)\/(page|route)\.[cm]?[jt]sx?$|(?:^|\/)(?:src\/)?app\/(page|route)\.[cm]?[jt]sx?$/.exec(relPath);
  if (app) {
    const segs = (app[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@') && !s.startsWith('_'));
    const kind = (app[2] ?? app[3]) === 'route' ? 'api-route' : 'page';
    return { segments: segs, kind };
  }
  const pages = /(?:^|\/)(?:src\/)?pages\/(.+)\.[cm]?[jt]sx?$/.exec(relPath);
  if (pages && !/(^|\/)_(app|document|error)$/.test(pages[1])) {
    const segs = pages[1].split('/').filter((s) => s && s !== 'index');
    if (segs[0] === 'api') {
      return { segments: segs, kind: 'api-route' };
    }
    return { segments: segs, kind: 'page' };
  }
  return null;
}

export function routePathFromSegments(segments: string[]): string {
  return '/' + segments.map((s) => (/^\[.*\]$/.test(s) ? ':param' : s)).join('/');
}

function keyFromSegments(segments: string[]): string | null {
  for (const seg of segments) {
    if (seg === 'api' || /^\[.*\]$/.test(seg) || /^v\d+$/.test(seg)) {
      continue;
    }
    return normalizeModuleKey(seg);
  }
  return null;
}

function keyFromRoutePath(p: string): string | null {
  return keyFromSegments(p.split('/').filter((s) => s && !s.startsWith(':')).map((s) => s.replace(/[^\w-]/g, '')));
}

/** Matches a fetch target to a route pattern; `:param` and `[x]` segments are wildcards. */
export function routeMatches(target: string, route: string, allowSuffix: boolean): boolean {
  const t = target.split('/').filter(Boolean);
  const r = route.split('/').filter(Boolean);
  const segEq = (a: string, b: string) => a === b || a.startsWith(':') || b.startsWith(':') || /^\[.*\]$/.test(b) || /^\[\[?\.\.\./.test(b);
  if (r.some((s) => /^\[\[?\.\.\./.test(s) || s === '*')) {
    const idx = r.findIndex((s) => /^\[\[?\.\.\./.test(s) || s === '*');
    return t.length >= idx && r.slice(0, idx).every((s, i) => segEq(t[i], s));
  }
  if (t.length === r.length) {
    return r.every((s, i) => segEq(t[i], s));
  }
  if (allowSuffix && r.length < t.length) {
    const offset = t.length - r.length;
    return r.every((s, i) => segEq(t[i + offset], s));
  }
  return false;
}

interface ModuleBuilder {
  key: string;
  files: Set<string>;
  evidence: ModuleEvidenceItem[];
  ui: boolean;
  api: boolean;
  data: boolean;
  tests: boolean;
  primary: boolean;
}

export function estimateProgress(inputs: ProgressInputs): ProgressReport {
  const modules = new Map<string, ModuleBuilder>();
  const fileModule = new Map<string, string>();
  const get = (key: string, primary: boolean): ModuleBuilder => {
    let m = modules.get(key);
    if (!m) {
      m = { key, files: new Set(), evidence: [], ui: false, api: false, data: false, tests: false, primary };
      modules.set(key, m);
    }
    m.primary ||= primary;
    return m;
  };
  const ev = (m: ModuleBuilder, kind: ModuleEvidenceItem['kind'], detail: string, f: DiscoveredFile, line = 1) => {
    if (m.evidence.length < 60) {
      m.evidence.push({ kind, detail, file: f.displayPath, uri: f.uri, line });
    }
  };

  const apiRoutes: { path: string; express: boolean }[] = [];
  let routeCount = 0;
  let componentCount = 0;
  let testFileCount = 0;

  // Pass 1: primary module sources — routes, API endpoints, models, services.
  for (const { file, roles, facts } of inputs.files) {
    const rel = file.relPath;
    if (roles.isTest) {
      testFileCount++;
      continue;
    }
    const next = nextRouteSegments(rel);
    if (next) {
      const key = keyFromSegments(next.segments) ?? (next.kind === 'page' && next.segments.length === 0 ? 'home' : null);
      const routePath = routePathFromSegments(next.segments);
      if (next.kind === 'api-route') {
        apiRoutes.push({ path: routePath, express: false });
      } else {
        routeCount++;
      }
      if (key) {
        const m = get(key, true);
        m.files.add(rel);
        fileModule.set(rel, key);
        if (next.kind === 'page') {
          m.ui = true;
          ev(m, 'page', `Page ${routePath}`, file);
        } else {
          m.api = true;
          const methods = facts.nextHandlers.map((h) => h.method).join(', ');
          ev(m, 'api-route', `API ${routePath}${methods ? ` (${methods})` : ''}`, file, facts.nextHandlers[0]?.line ?? 1);
        }
      }
    }
    // Sub-routers in routes/ or controllers/ files are grouped by file name (paths are mount-relative).
    const fileKey = normalizeModuleKey(rel.split('/').pop() ?? '');
    const routerFile = /(^|\/)(routes?|routers?|controllers?|api)\//.test(rel);
    for (const r of facts.expressRoutes) {
      apiRoutes.push({ path: r.path, express: true });
      const key = routerFile && fileKey ? fileKey : keyFromRoutePath(r.path) ?? fileKey;
      if (key) {
        const m = get(key, true);
        m.api = true;
        m.files.add(rel);
        fileModule.set(rel, fileModule.get(rel) ?? key);
        ev(m, 'api-route', `${r.method} ${r.path}`, file, r.line);
      }
    }
    for (const model of facts.models) {
      const key = normalizeModuleKey(model.name);
      if (key) {
        const m = get(key, true);
        m.data = true;
        m.files.add(rel);
        ev(m, 'model', `Model ${model.name}`, file, model.line);
      }
    }
    const folder = /(?:^|\/)(services?|controllers?|models?|routes?|repositories|handlers|actions|features|modules|resolvers)\/(?:([\w-]+)\/)?([\w.-]+)$/.exec(rel);
    if (folder && !next) {
      const key = normalizeModuleKey(folder[2] && /^(features|modules)$/.test(folder[1]) ? folder[2] : folder[3]);
      if (key) {
        const m = get(key, true);
        m.files.add(rel);
        fileModule.set(rel, fileModule.get(rel) ?? key);
        const kind = /models?/.test(folder[1]) ? 'model' : 'service';
        if (kind === 'model') {
          m.data = true;
        }
        ev(m, kind, `${folder[1]}/${folder[3]}`, file);
      }
    }
  }

  // Pass 2: attach components, hooks and tests to existing modules by name.
  for (const { file, roles, facts } of inputs.files) {
    const rel = file.relPath;
    const base = rel.split('/').pop() ?? '';
    if (roles.isTest) {
      const key = normalizeModuleKey(base.replace(/\.(test|spec|e2e)\.[cm]?[jt]sx?$/, ''));
      const m = key ? modules.get(key) : undefined;
      if (m) {
        m.tests = true;
        m.files.add(rel);
        ev(m, 'test', base, file);
      }
      continue;
    }
    if (facts.hasJsx && !nextRouteSegments(rel)) {
      componentCount++;
      const segs = rel.split('/');
      const candidates = [...segs.slice(0, -1).reverse().slice(0, 2), base.split(/(?=[A-Z])/)[0], base];
      for (const c of candidates) {
        const key = normalizeModuleKey(c);
        const m = key ? modules.get(key) : undefined;
        if (m) {
          m.ui = true;
          m.files.add(rel);
          fileModule.set(rel, fileModule.get(rel) ?? m.key);
          ev(m, 'component', base, file);
          break;
        }
      }
    }
    const key = fileModule.get(rel);
    const m = key ? modules.get(key) : undefined;
    if (m) {
      if (facts.hasDataAccess) {
        m.data = true;
        ev(m, 'data-access', 'Database access', file);
      }
      if (facts.hasAuthSignal && m.key !== 'auth') {
        ev(m, 'auth', 'Authentication check', file);
      }
    }
  }

  // Placeholders (AST + markers) attached to modules.
  const allPlaceholders: PlaceholderLocation[] = [...inputs.markerPlaceholders, ...inputs.files.flatMap((f) => (f.roles.isTest ? [] : f.facts.placeholders))];
  const placeholderByModule = new Map<string, PlaceholderLocation[]>();
  const fileByDisplay = new Map(inputs.files.map((f) => [f.file.displayPath, f.file]));
  for (const p of allPlaceholders) {
    const f = fileByDisplay.get(p.file);
    const key = f ? fileModule.get(f.relPath) : undefined;
    if (key) {
      const list = placeholderByModule.get(key) ?? [];
      list.push(p);
      placeholderByModule.set(key, list);
    }
  }

  // Missing endpoints: UI calls to /api/... with no matching route.
  const missingByModule = new Map<string, { target: string; file: DiscoveredFile; line: number }[]>();
  const checkEndpoints = !inputs.hasApiProxy && apiRoutes.length > 0;
  if (checkEndpoints) {
    for (const { file, roles, facts } of inputs.files) {
      if (roles.isTest) {
        continue;
      }
      for (const t of facts.fetchTargets) {
        const exists = apiRoutes.some((r) => routeMatches(t.path, r.path, r.express));
        if (!exists) {
          const key = fileModule.get(file.relPath) ?? keyFromRoutePath(t.path);
          if (key) {
            const list = missingByModule.get(key) ?? [];
            list.push({ target: t.path, file, line: t.line });
            missingByModule.set(key, list);
            get(key, true).files.add(file.relPath);
          }
        }
      }
    }
  }

  const result: FunctionalModule[] = [];
  for (const m of modules.values()) {
    if (!m.primary) {
      continue;
    }
    const placeholders = placeholderByModule.get(m.key) ?? [];
    const missing = missingByModule.get(m.key) ?? [];
    const reasons: string[] = [];
    let completion = 100;
    const penalize = (amount: number, cap: number, count: number, reason: string) => {
      if (count > 0) {
        const p = Math.min(cap, amount * count);
        completion -= p;
        reasons.push(`${reason} (−${p})`);
      }
    };
    const count = (kinds: PlaceholderLocation['kind'][]) => placeholders.filter((p) => kinds.includes(p.kind)).length;
    penalize(15, 60, count(['not-implemented', 'empty-function', 'status-501']), `${count(['not-implemented', 'empty-function', 'status-501'])} unimplemented function(s) or handler(s)`);
    penalize(15, 30, count(['mock-data']), `${count(['mock-data'])} hardcoded mock data set(s)`);
    penalize(25, 50, count(['placeholder-text']), `${count(['placeholder-text'])} placeholder text block(s) such as "coming soon"`);
    penalize(20, 40, missing.length, `${missing.length} UI call(s) to API endpoints that were not found`);
    const fixmes = count(['fixme']);
    const todos = count(['todo']);
    penalize(1, 20, fixmes * 5 + todos * 3, `${todos} TODO / ${fixmes} FIXME marker(s)`);
    if (m.api && !m.data && inputs.hasDatabase) {
      completion -= 15;
      reasons.push('API handlers found but no data access detected (−15)');
    }
    completion = Math.max(5, Math.round(completion));
    const hasBlocking = count(['not-implemented', 'empty-function', 'status-501', 'mock-data', 'placeholder-text']) > 0 || missing.length > 0;
    const status = completion >= 85 && !hasBlocking ? 'implemented' : 'partial';
    if (!reasons.length) {
      reasons.push('No placeholders, unfinished handlers or broken UI→API connections were detected.');
    }
    if (!m.tests) {
      reasons.push('No tests were associated with this module (informational, not penalized).');
    }

    const evidence = [...m.evidence];
    for (const p of placeholders.slice(0, 20)) {
      evidence.push({ kind: p.kind === 'todo' || p.kind === 'fixme' ? 'todo' : p.kind === 'mock-data' ? 'mock-data' : 'placeholder', detail: p.detail, file: p.file, uri: p.uri, line: p.line });
    }
    for (const x of missing.slice(0, 10)) {
      evidence.push({ kind: 'missing-endpoint', detail: `Calls ${x.target}, but no matching API route was found`, file: x.file.displayPath, uri: x.file.uri, line: x.line });
    }

    result.push({
      id: m.key,
      name: displayName(m.key),
      status,
      completion,
      layers: { ui: m.ui, api: m.api, data: m.data, tests: m.tests },
      fileCount: m.files.size,
      evidence,
      reasons
    });
  }
  result.sort((a, b) => a.completion - b.completion || a.name.localeCompare(b.name));

  const limitations = [
    'Modules are inferred from routes, API handlers, models and folder names; features without such structure may not be detected.',
    'Completion is a heuristic based on placeholders, TODO markers, mock data and missing UI→API connections — not on your actual requirements.',
    'Tests are reported but not penalized; their presence does not prove correctness.'
  ];
  if (!checkEndpoints) {
    limitations.push(inputs.hasApiProxy ? 'API proxy/rewrites detected — missing-endpoint checks were skipped.' : 'No API routes found — missing-endpoint checks were skipped.');
  }

  const report: ProgressReport = {
    modules: result,
    implementationEvidence: result.length ? Math.round(result.reduce((s, m) => s + m.completion, 0) / result.length) : null,
    placeholders: allPlaceholders.slice(0, 500),
    routeCount,
    apiEndpointCount: apiRoutes.length,
    componentCount,
    testFileCount,
    limitations
  };

  if (inputs.requirements) {
    const moduleFiles = new Map([...modules.values()].map((m) => [m.key, [...m.files]]));
    const results = evaluateRequirements(inputs.requirements.features, result, moduleFiles);
    report.requirements = {
      file: inputs.requirements.file,
      results,
      weightedCompletion: weightedCompletion(results.map((r) => ({ weight: r.feature.weight, completion: r.completion }))),
      errors: inputs.requirements.errors
    };
  }
  return report;
}
