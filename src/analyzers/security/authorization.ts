import type { Finding } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { findingAt, createFinding, type RuleMeta } from '../../core/findings';
import { AUTH_MIDDLEWARE_NAME, AUTH_SIGNAL, type FileFacts } from '../progress/facts';

const base = { category: 'security', analyzer: 'security-ast', status: 'needs-review' } as const;

export const AUTHZ_RULES = {
  missingAuthorization: {
    ...base,
    id: 'sec/missing-authorization',
    title: 'Mutating endpoint without visible authorization',
    severity: 'medium',
    confidence: 'low',
    description:
      'This handler modifies state, but no authentication/authorization check was found in the file or its route middleware. Authorization may be enforced elsewhere (global middleware, gateway).',
    impact: 'If no upstream check exists, any client can invoke the operation.',
    recommendation: 'Verify the session/token and the caller\'s permission for the specific resource before performing the operation.'
  },
  sensitiveRead: {
    ...base,
    id: 'sec/unprotected-sensitive-read',
    title: 'Sensitive endpoint without visible authorization',
    severity: 'low',
    confidence: 'low',
    description: 'A GET handler under a sensitive-looking path (admin, account, billing, …) has no visible authorization check.',
    impact: 'Private data may be exposed to unauthenticated users.',
    recommendation: 'Confirm the route is protected by middleware or add an explicit session check.'
  },
  serverAction: {
    ...base,
    id: 'sec/server-action-no-auth',
    title: 'Server action without visible authorization',
    severity: 'medium',
    confidence: 'low',
    description: 'Server actions are publicly callable POST endpoints. This file accesses data but contains no session/auth check.',
    impact: 'Anyone can invoke the action directly, bypassing UI-level restrictions.',
    recommendation: 'Authenticate and authorize inside every server action that reads or mutates protected data.'
  },
  webhookSignature: {
    ...base,
    id: 'sec/webhook-no-signature',
    title: 'Webhook handler without signature verification',
    severity: 'medium',
    confidence: 'medium',
    description: 'A webhook endpoint does not appear to verify the request signature.',
    impact: 'Attackers can forge webhook events (e.g. fake payments).',
    recommendation: 'Verify the provider signature (e.g. `stripe.webhooks.constructEvent`, Svix, HMAC comparison) before processing.'
  },
  noHelmet: {
    ...base,
    id: 'sec/express-no-security-headers',
    title: 'Express app without security headers middleware',
    severity: 'low',
    confidence: 'medium',
    kind: 'recommendation',
    description: 'Express is used, but no `helmet` (or equivalent) middleware was found anywhere in the project.',
    impact: 'Missing headers (CSP, HSTS, X-Content-Type-Options) weaken browser-side protections.',
    recommendation: 'Add `helmet()` or configure the equivalent security headers manually or at the proxy.'
  }
} satisfies Record<string, RuleMeta>;

const PUBLIC_PATH = /(login|signin|sign-in|signup|sign-up|register|logout|auth|oauth|callback|health|status|ping|public|forgot|reset|verify|confirm|contact|newsletter|subscribe|csrf|webhook|og|sitemap|robots|cron)/i;
const SENSITIVE_PATH = /(admin|account|billing|invoice|payment|orders?|users?|profile|settings|private|dashboard|internal|secrets?|keys?)/i;
const MUTATING = /^(POST|PUT|PATCH|DELETE)$/;
const SIGNATURE = /constructEvent|verifySignature|verifyWebhook|svix|Webhook\(|createHmac|timingSafeEqual|x-hub-signature|stripe-signature|signature/i;

function nextRoutePath(relPath: string): string {
  return relPath
    .replace(/^(src\/)?app\//, '/')
    .replace(/^(src\/)?pages\//, '/')
    .replace(/\/route\.[cm]?[jt]s$|\.[cm]?[jt]sx?$/, '')
    .replace(/\/\([^)]*\)/g, '');
}

/** Per-file authorization candidates; refined project-wide by `refineAuthorizationFindings`. */
export function analyzeAuthorization(ctx: FileContext, facts: FileFacts): Finding[] {
  if (ctx.roles.isTest) {
    return [];
  }
  const findings: Finding[] = [];
  const fileHasAuth = facts.hasAuthSignal;
  const rel = ctx.file.relPath;

  if (ctx.roles.isNextApiRoute) {
    const route = nextRoutePath(rel);
    if (/webhook/i.test(route) && !SIGNATURE.test(ctx.text)) {
      findings.push(findingAt(ctx, AUTHZ_RULES.webhookSignature, { line: facts.nextHandlers[0]?.line ?? 1 }, { tags: ['next'] }));
    }
    if (!fileHasAuth && !PUBLIC_PATH.test(route)) {
      const handlers = facts.nextHandlers.length
        ? facts.nextHandlers
        : /pages\/api\//.test(rel) && facts.hasDataAccess
          ? [{ method: 'POST', line: 1, empty: false }]
          : [];
      for (const h of handlers) {
        if (MUTATING.test(h.method) && !h.empty) {
          findings.push(findingAt(ctx, AUTHZ_RULES.missingAuthorization, { line: h.line }, { tags: ['next', 'authz-candidate'], description: `${AUTHZ_RULES.missingAuthorization.description} Route: ${h.method} ${route}.` }));
        } else if (h.method === 'GET' && SENSITIVE_PATH.test(route) && facts.hasDataAccess) {
          findings.push(findingAt(ctx, AUTHZ_RULES.sensitiveRead, { line: h.line }, { tags: ['next', 'authz-candidate'], description: `${AUTHZ_RULES.sensitiveRead.description} Route: GET ${route}.` }));
        }
      }
    }
  }

  if (facts.expressRoutes.length) {
    const routerLevelAuth = facts.useCalls.some((u) => u.names.some((n) => AUTH_MIDDLEWARE_NAME.test(n)));
    for (const r of facts.expressRoutes) {
      if (/webhook/i.test(r.path) && !SIGNATURE.test(ctx.text)) {
        findings.push(findingAt(ctx, AUTHZ_RULES.webhookSignature, { line: r.line }, { tags: ['express'] }));
        continue;
      }
      const protectedRoute = routerLevelAuth || r.middleware.some((m) => AUTH_MIDDLEWARE_NAME.test(m));
      if (protectedRoute || PUBLIC_PATH.test(r.path)) {
        continue;
      }
      // A handler that itself checks req.user etc. counts as protected.
      const handlerText = ctx.lines.slice(r.line - 1, r.line + 25).join('\n');
      if (AUTH_SIGNAL.test(handlerText)) {
        continue;
      }
      if (MUTATING.test(r.method)) {
        findings.push(findingAt(ctx, AUTHZ_RULES.missingAuthorization, { line: r.line }, { tags: ['express', 'authz-candidate'], description: `${AUTHZ_RULES.missingAuthorization.description} Route: ${r.method} ${r.path}.` }));
      } else if (r.method === 'GET' && SENSITIVE_PATH.test(r.path) && facts.hasDataAccess) {
        findings.push(findingAt(ctx, AUTHZ_RULES.sensitiveRead, { line: r.line }, { tags: ['express', 'authz-candidate'], description: `${AUTHZ_RULES.sensitiveRead.description} Route: GET ${r.path}.` }));
      }
    }
  }

  if (facts.isServerAction && facts.hasDataAccess && !fileHasAuth && facts.serverActionExports.length) {
    findings.push(findingAt(ctx, AUTHZ_RULES.serverAction, { line: facts.serverActionExports[0].line }, { tags: ['next', 'authz-candidate'] }));
  }
  return findings;
}

export interface ProjectAuthContext {
  /** Next.js middleware file with authentication signals. */
  nextMiddlewareWithAuth: string | null;
  /** Global Express middleware (`app.use(auth)`) detected somewhere. */
  globalExpressAuth: string | null;
  expressFiles: { file: string; uri: string }[];
  helmetUsed: boolean;
}

/** Applies project-wide context: global middleware lowers confidence; adds helmet recommendation. */
export function refineAuthorizationFindings(findings: Finding[], ctx: ProjectAuthContext): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    if (!f.tags?.includes('authz-candidate')) {
      out.push(f);
      continue;
    }
    const isNext = f.tags.includes('next');
    const globalAuth = isNext ? ctx.nextMiddlewareWithAuth : ctx.globalExpressAuth;
    if (globalAuth) {
      out.push({
        ...f,
        severity: 'info',
        confidence: 'low',
        description: `${f.description} Global middleware with authentication logic was found in ${globalAuth}; confirm it covers this route.`
      });
    } else {
      out.push(f);
    }
  }
  if (ctx.expressFiles.length && !ctx.helmetUsed) {
    const first = ctx.expressFiles[0];
    out.push(createFinding(AUTHZ_RULES.noHelmet, { file: first.file, uri: first.uri, line: 1 }, 'express() without helmet()'));
  }
  return out;
}
