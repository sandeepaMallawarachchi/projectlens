import Image from 'next/image';
import { env } from '@/lib/env';
import { emailEnabled } from '@/lib/email';
import { limits } from '@/lib/quotas';
import { CodeBlock } from './components/CodeBlock';
import { ExtensionTour } from './components/ExtensionTour';
import { ThemeToggle } from './components/ThemeToggle';
import { CopyChip } from './components/CopyChip';
import { EXTENSION_ID, MARKETPLACE_URL, OPEN_VSX_URL, storeVersions } from '@/lib/store-versions';
import { GitHubIcon, GitLabIcon, PlugIcon, SparklesIcon, VSCodeIcon, BracesIcon, ActivityIcon, CursorIcon, WindsurfIcon, VSCodiumIcon, OpenVSXIcon } from './components/BrandIcons';
import { NavLinks } from './components/NavLinks';
import { ScrollEffects } from './components/ScrollEffects';

export const dynamic = 'force-dynamic';

const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=SandeepaMallawarachchi.projectlens';
const LINKEDIN = 'https://www.linkedin.com/in/sandeepa-mallawarachchi';
const GITHUB = 'https://github.com/sandeepaMallawarachchi';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface Endpoint {
  method: Method;
  path: string;
  scope: string;
  description: string;
}

/** Editors that install from Open VSX. */
const OPEN_VSX_EDITORS = ['Cursor', 'Antigravity', 'Windsurf', 'VSCodium'] as const;

function EditorIcon({ name, size = 16 }: { name: (typeof OPEN_VSX_EDITORS)[number]; size?: number }) {
  switch (name) {
    case 'Cursor':
      return <CursorIcon size={size} />;
    case 'Windsurf':
      return <WindsurfIcon size={size} />;
    case 'VSCodium':
      return <VSCodiumIcon size={size} />;
    default:
      // Official Antigravity mark (gradient), from antigravity.google.
      return <Image src="/brands/antigravity.svg" alt="" width={size} height={size} />;
  }
}

function EditorTile({ name }: { name: (typeof OPEN_VSX_EDITORS)[number] }) {
  return (
    <span className="editor-chip">
      <EditorIcon name={name} />
      {name}
    </span>
  );
}

function ShieldNoteIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}


const GROUPS: { title: string; note: string; endpoints: Endpoint[] }[] = [
  {
    title: 'Projects',
    note: 'API key or session',
    endpoints: [
      { method: 'GET', path: '/projects', scope: 'read', description: 'Projects with their latest overview. Filter with ?externalId=' },
      { method: 'POST', path: '/projects', scope: 'scan', description: 'Register a project: provider github | gitlab | none (uploads only)' },
      { method: 'GET', path: '/projects/{id}', scope: 'read', description: 'Overview, latest scan and score trend. {id} = UUID or ext:<externalId>' },
      { method: 'PATCH', path: '/projects/{id}', scope: 'scan', description: 'Update name, ref, access token (null removes), externalId, metadata' },
      { method: 'DELETE', path: '/projects/{id}', scope: 'admin', description: 'Delete a project and its history' }
    ]
  },
  {
    title: 'Scans',
    note: 'cloud scans and uploads',
    endpoints: [
      { method: 'POST', path: '/projects/{id}/scans', scope: 'scan', description: 'Run a cloud scan. 202 background · 200 done or cached · 409 running · 429 limited' },
      { method: 'GET', path: '/projects/{id}/scans', scope: 'read', description: 'Scan history (newest first)' },
      { method: 'POST', path: '/projects/{id}/uploads', scope: 'scan', description: 'Upload a scan result from the VS Code extension' },
      { method: 'GET', path: '/scans/{id}', scope: 'read', description: 'Status, overview, score explanations and modules' },
      { method: 'GET', path: '/scans/{id}/findings', scope: 'read', description: 'Findings with links to code. Filters: severity, category, status, file' },
      { method: 'GET', path: '/scans/{id}/report', scope: 'read', description: 'Full report: ?format=markdown | json' }
    ]
  },
  {
    title: 'AI insights',
    note: "uses the organization's own AI key",
    endpoints: [
      { method: 'POST', path: '/scans/{id}/insights', scope: 'ai', description: 'projectAssessment, architectureSummary, improvements, securityConcerns, …' },
      { method: 'GET', path: '/scans/{id}/insights', scope: 'read', description: 'Insights generated for a scan' },
      { method: 'GET', path: '/projects/{id}/insights', scope: 'read', description: 'Insights generated for a project' }
    ]
  },
  {
    title: 'Organization',
    note: 'API keys & usage',
    endpoints: [
      { method: 'GET', path: '/usage', scope: 'read', description: 'Usage and plan limits of your organization' },
      { method: 'GET', path: '/keys', scope: 'admin', description: 'List API keys' },
      { method: 'POST', path: '/keys', scope: 'admin', description: 'Create an API key (shown once)' },
      { method: 'DELETE', path: '/keys/{id}', scope: 'admin', description: 'Revoke an API key' },
      { method: 'POST', path: '/webhook-secret', scope: 'admin', description: 'Create or rotate the webhook signing secret (shown once); GET shows status, DELETE removes it' }
    ]
  },
  {
    title: 'Prompt Guard',
    note: 'Sensitive-data policy for AI coding tools',
    endpoints: [
      { method: 'GET', path: '/prompt-guard/policy', scope: 'read', description: 'Policy: mode (off | optional | required), notice, detectors, custom rules, allowlist' },
      { method: 'PUT', path: '/prompt-guard/policy', scope: 'admin', description: 'Update any subset. Changing mode or notice asks members to accept again' },
      { method: 'GET', path: '/prompt-guard/events', scope: 'audit', description: 'Flagged prompts, metadata only (never prompt text). Filters: since, userId, tool. Pages of up to 500: pass pagination.nextBefore as ?before=' },
      { method: 'GET', path: '/prompt-guard/summary', scope: 'audit', description: 'Totals by rule, tool and category, and member consent. ?days=1-90' },
      { method: 'GET', path: '/prompt-guard/members', scope: 'audit', description: 'Consent status and protected AI tools per member' }
    ]
  },
  {
    title: 'Accounts & teams',
    note: 'user sessions (used by the VS Code extension)',
    endpoints: [
      { method: 'POST', path: '/auth/github', scope: 'public', description: 'Sign in with a GitHub token → session' },
      { method: 'POST', path: '/auth/email/start', scope: 'public', description: 'Email a 6-digit sign-in code' },
      { method: 'POST', path: '/auth/email/verify', scope: 'public', description: 'Verify the code → session' },
      { method: 'GET', path: '/me', scope: 'session', description: 'Current user and organizations' },
      { method: 'POST', path: '/orgs', scope: 'session', description: 'Create an organization' },
      { method: 'GET', path: '/orgs/{id}/members', scope: 'session', description: 'Members; PATCH/DELETE /orgs/{id}/members/{userId} to manage' },
      { method: 'POST', path: '/orgs/{id}/invitations', scope: 'admin role', description: 'Invite by email - joins automatically on sign-in' },
      { method: 'PUT', path: '/orgs/{id}/ai-keys/{provider}', scope: 'admin role', description: 'Set the organization AI key (Groq, OpenAI, Gemini, Claude)' }
    ]
  }
];

const OVERVIEW_FIELDS: [string, string][] = [
  ['scores.{quality,security,implementation,readiness}', '0–100, or null when not assessed (never treat null as 0)'],
  ['findings.bySeverity, findings.needsReview', 'Counts by severity; items needing application context'],
  ['progress.estimate, progress.modules[]', 'Completion estimate and per-module status (implemented / partial)'],
  ['topRisks[]', 'Most important findings, each with a link to the exact line'],
  ['technologies[], languages[]', 'Detected stack with versions'],
  ['recommendedActions[]', 'Prioritized next steps'],
  ['trend[] (on GET /projects/{id})', 'Score history for charts']
];

const STATUS_CODES: [string, string][] = [
  ['200 / 201', 'Success. Responses are wrapped as { "data": … }'],
  ['202', 'Scan accepted and running in the background'],
  ['400', 'Invalid request, repository not found / token invalid, AI key not configured'],
  ['401', 'Missing, invalid or revoked key or session'],
  ['403', 'Key lacks the required scope, or not a member of the organization'],
  ['404', 'Not found in your organization'],
  ['409', 'A scan is already running'],
  ['429', 'Rate limit or plan quota reached - see error.details'],
  ['5xx', 'ProjectLens or an upstream service (GitHub, GitLab, AI provider) failed - retry with backoff']
];

/** What to grant an API key, by what you are building. */
const SCOPE_GUIDE: [string, string][] = [
  ['Show project health in a dashboard', 'read'],
  ['Register projects and trigger scans', 'read · scan'],
  ['Request AI insights', 'read · ai'],
  ['Show Prompt Guard reports', 'audit'],
  ['Edit the Prompt Guard policy, manage keys or the webhook secret', 'admin (avoid for everyday integrations)'],
  ['Health check (GET /health)', 'none - no key needed']
];

const TROUBLESHOOTING: [string, React.ReactNode][] = [
  [
    'Is the error from ProjectLens or from my backend?',
    <>
      ProjectLens errors always look like <code>{'{ "error": { "code", "message" } }'}</code>. A different shape (or an HTML error page) comes from your own backend, often a missing{' '}
      <code>PROJECTLENS_API_KEY</code>, an old base URL, or an integration deployed before an API change. Test the key directly: <code>curl $PL_API/usage -H &quot;Authorization: Bearer $PL_KEY&quot;</code>.
    </>
  ],
  ['401 unauthorized', <>The key is mistyped, revoked, or not a <code>plk_…</code> key. Create a new one in VS Code → ProjectLens → Cloud → API keys.</>],
  ['403 forbidden', <>The key lacks a scope for this endpoint (see the table above). Create a key with the needed scope; scopes cannot be added to an existing key.</>],
  [
    '400 when registering or scanning a private repository',
    <>
      The repository token is missing or cannot read that repository. Use a GitHub token with <em>Contents: Read</em> on the repository, or a GitLab token with <em>read_repository</em>.
      Connecting GitLab or GitHub to another tool does not give ProjectLens access.
    </>
  ],
  ['400 ai_not_configured', <>Add your organization&apos;s AI key in VS Code → ProjectLens → Cloud → Cloud AI keys.</>],
  ['Scan stays queued or running', <>Keep polling <code>GET /scans/{'{id}'}</code> every 3 to 5 seconds; most scans finish in under a minute. A <code>failed</code> scan has the reason in <code>error</code>.</>],
  [
    'Webhook signature does not match',
    <>
      Compute the HMAC over the <strong>raw</strong> request body (before JSON parsing) with your organization&apos;s webhook secret. If an admin rotated the secret, update it in your
      backend.
    </>
  ]
];

const TERMINAL_LINES = [
  <><span className="t-prompt">$</span> curl $PL_API/projects/ext:pm-42 -H <span className="t-str">&quot;Authorization: Bearer plk_…&quot;</span></>,
  <span className="t-status">HTTP/2 200</span>,
  <>{'{'} <span className="t-key">&quot;data&quot;</span>: {'{'} <span className="t-key">&quot;latestScan&quot;</span>: {'{'} <span className="t-key">&quot;overview&quot;</span>: {'{'}</>,
  <>  <span className="t-key">&quot;primaryFramework&quot;</span>: <span className="t-str">&quot;Next.js&quot;</span>,</>,
  <>  <span className="t-key">&quot;findings&quot;</span>: {'{'} <span className="t-key">&quot;critical&quot;</span>: <span className="t-num">0</span>, <span className="t-key">&quot;high&quot;</span>: <span className="t-num">2</span> {'}'},</>,
  <>  <span className="t-key">&quot;progress&quot;</span>: {'{'} <span className="t-key">&quot;estimate&quot;</span>: <span className="t-num">78</span>, <span className="t-key">&quot;modules&quot;</span>: <span className="t-muted">[…]</span> {'}'},</>,
  <>  <span className="t-key">&quot;topRisks&quot;</span>: <span className="t-muted">[ {'{'} &quot;title&quot;: &quot;SQL built from…&quot;, &quot;url&quot;: &quot;…#L42&quot; {'}'} ]</span></>,
  <>{'}'} {'}'} {'}'} {'}'}<span className="t-cursor" /></>
];

const HERO_SCORES: [string, number, string][] = [
  ['Security', 86, 'var(--green)'],
  ['Quality', 74, 'var(--accent)'],
  ['Progress', 78, 'var(--purple)'],
  ['Readiness', 69, 'var(--orange)']
];

export default async function Home() {
  // Examples always show the public production URL, regardless of where the page is served from.
  const versions = await storeVersions();
  const base = `${(process.env.PROJECTLENS_PUBLIC_URL || 'https://projectlensai.vercel.app').replace(/\/+$/, '')}/api/v1`;
  const e = env();
  const l = limits();
  const operational = e.storage === 'supabase';
  const email = emailEnabled();

  const curlSample = `# Complete flow: register → scan → wait → results. Needs curl and jq.
# Your organization API key (VS Code → ProjectLens → Cloud → API keys), scopes read + scan
export PL_KEY=plk_your_key
export PL_API=${base}
AUTH="Authorization: Bearer $PL_KEY"

# 1. Register the project once (externalId = your tool's own id).
#    accessToken is a read-only REPOSITORY token, only needed for private repositories.
curl -sS -X POST "$PL_API/projects" -H "$AUTH" -H "content-type: application/json" \\
  -d '{"name":"Customer Portal","provider":"github","repository":"acme/portal","externalId":"pm-42","accessToken":"github_pat_…"}'

# 2. Start a full scan and keep its id
SCAN_ID=$(curl -sS -X POST "$PL_API/projects/ext:pm-42/scans" -H "$AUTH" \\
  -H "content-type: application/json" -d '{"mode":"full"}' | jq -r '.data.id')

# 3. Wait until it finishes
while true; do
  STATUS=$(curl -sS "$PL_API/scans/$SCAN_ID" -H "$AUTH" | jq -r '.data.status')
  echo "scan $SCAN_ID: $STATUS"
  if [ "$STATUS" = completed ] || [ "$STATUS" = failed ]; then break; fi
  sleep 3
done

# 4. Show scores and the top high-severity findings
curl -sS "$PL_API/scans/$SCAN_ID" -H "$AUTH" | jq '.data.overview.scores'
curl -sS "$PL_API/scans/$SCAN_ID/findings?severity=high&limit=5" -H "$AUTH" \\
  | jq '.data[] | {title, severity, url}'`;

  const tsSample = `// Server-side only - never expose the key to the browser.
const BASE = process.env.PROJECTLENS_API_URL!; // ${base}
const KEY = process.env.PROJECTLENS_API_KEY!;  // plk_…

class ProjectLensError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function projectlens<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(\`\${BASE}\${path}\`, {
    ...init,
    headers: { authorization: \`Bearer \${KEY}\`, 'content-type': 'application/json', ...init.headers },
    cache: 'no-store'
  });
  const body = await res.json().catch(() => null);
  // ProjectLens errors are always { error: { code, message } }.
  if (!res.ok) throw new ProjectLensError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? \`ProjectLens \${res.status}\`);
  return body.data as T; // every response is wrapped as { data: … }
}

type Scan = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; error: string | null; overview: any };

/** Starts a full scan and resolves when it has finished. */
export async function scanAndWait(externalId: string, timeoutMs = 5 * 60_000): Promise<Scan> {
  let scan = await projectlens<Scan>(\`/projects/ext:\${externalId}/scans\`, { method: 'POST', body: JSON.stringify({ mode: 'full' }) });
  const deadline = Date.now() + timeoutMs;
  while (scan.status === 'queued' || scan.status === 'running') {
    if (Date.now() > deadline) throw new Error('Scan is still running; check again later');
    await new Promise((r) => setTimeout(r, 3000));
    scan = await projectlens<Scan>(\`/scans/\${scan.id}\`);
  }
  if (scan.status === 'failed') throw new Error(\`Scan failed: \${scan.error}\`);
  return scan;
}

const scan = await scanAndWait('pm-42');
console.log(scan.overview.scores.security.score);`;

  const aiPrompt = `Integrate the ProjectLens Cloud API into this application.

## About ProjectLens
ProjectLens analyzes GitHub/GitLab projects and reports code quality, security, implementation progress and production readiness, plus optional AI insights. Use it to show project health in this app and to trigger analyses remotely.

## Connection
- Base URL: ${base}  (env: PROJECTLENS_API_URL)
- Auth header: Authorization: Bearer <PROJECTLENS_API_KEY>  (an organization API key "plk_…" with scopes read, scan, ai; add audit and admin only if building the Prompt Guard screens)
- Call the API ONLY from server-side code (API routes, server actions, jobs). Never expose the key to the browser.
- Responses are JSON wrapped as { "data": … }. Errors: { "error": { "code", "message", "details" } } with the HTTP status.
- Full OpenAPI 3.1 spec: ${base}/openapi.json

## Getting the API key (important)
- ProjectLens API keys are created ONLY in the "ProjectLens AI" VS Code extension: ProjectLens dashboard → Cloud → sign in → API keys → Create key (scopes read, scan, ai). Only organization owners/admins can create keys. The key is shown once.
- There is NO web console or website page for creating keys. Do not invent one, and do not tell the user to look for "API Keys" in organization settings on a website.
- Ask the user to add the key as a server-side secret named PROJECTLENS_API_KEY (and PROJECTLENS_API_URL=${base}) using this platform's secret/environment mechanism. Never ask them to paste the key into chat or into frontend/public environment variables.

## Key concepts
- Project = one repository. Register projects with externalId = this app's project id, then address them as /projects/ext:<id> (no ProjectLens ids to store).
- Scan = one analysis (status: queued → running → completed | failed). Completed scans have an "overview".
- Scores are 0–100 or null (= not assessed; never show null as 0). Findings are advisory with severity, confidence and status (confirmed | needs-review).

## Endpoints to use
- POST /projects { name, provider: "github"|"gitlab"|"none", repository (URL or owner/repo), externalId, accessToken? (read-only repo token for private repos), ref? } → 201 Project (409 if externalId exists)
- PATCH /projects/{id} { accessToken?: string|null, name?, ref?, externalId? }
- GET /projects/{id} → { latestScan: { status, source, finishedAt, overview }, trend: [{ finishedAt, quality, security, implementation, readiness, critical, high }] }
- POST /projects/{id}/scans { mode: "full" } → 202 (poll GET /scans/{scanId} every ~3 s until completed/failed) | 200 { cached: true } (commit already scanned) | 409 scan_in_progress | 429 rate_limited/quota_exceeded (see error.details)
- GET /scans/{scanId} → overview + scores[*].checks/caps/explanation (why a score is what it is) + modules[]
- GET /scans/{scanId}/findings?severity=high&limit=20 → { data: Finding[], pagination } - each finding has title, severity, confidence, status, file, line, url (link to the line on GitHub/GitLab), description, recommendation, evidence (redacted)
- GET /scans/{scanId}/report?format=markdown|json
- POST /scans/{scanId}/insights { task: "projectAssessment" | "architectureSummary" | "improvements" | "securityConcerns" | "incompletePatterns" } → 201 { analysis: { summary, observations[], recommendations[] }, fileUris } - synchronous, 10–120 s; 400 ai_not_configured if the organization has no AI key
- GET /usage → plan limits and usage

## Prompt Guard (optional: sensitive-data policy for AI coding tools)
Team members' prompts to Claude Code, Codex, Cursor, GitHub Copilot and Antigravity are checked on their own computers by the ProjectLens extension. Prompt text is never uploaded; the API only holds the policy and metadata events.
- GET /prompt-guard/policy (scope read) → { mode: "off"|"optional"|"required", notice, consentVersion, builtin: { secrets, "pii.card", "pii.email", "pii.phone": "off"|"warn"|"redact"|"block" }, customRules: [{ id, name, type: "term"|"regex", pattern, action }], allowlist: string[], webhookUrl, version }
- PUT /prompt-guard/policy (scope admin) with any subset of those fields. Changing mode or notice makes members accept again. "required" withholds organization projects from members until they accept.
- GET /prompt-guard/events?since=&before=&userId=&tool=&limit= (scope audit, max 500 per page; use pagination.nextBefore as the next ?before=) → [{ id, userId, tool, action: "blocked"|"warned"|"detected", ruleIds, categories, project, occurredAt }]. "detected" = sent anyway (Copilot hooks cannot block).
- GET /prompt-guard/summary?days=30 and GET /prompt-guard/members (scope audit) for dashboards.
- Optional webhook: set webhookUrl in the policy to receive signed "prompt.flagged" events (same signature scheme as scan webhooks).
Show events as compliance metadata: never imply that ProjectLens has the prompt text.

## overview fields (latestScan.overview)
scores.{quality,security,implementation,readiness}.{score,grade,verdict}; findings.{total,bySeverity,needsReview}; progress.{label,estimate,modules[{name,status,completion}]}; technologies[]; topRisks[{title,severity,file,line,url}]; recommendedActions[{title,detail,priority}]

## Optional webhooks
Send callbackUrl (HTTPS) when triggering a scan. ProjectLens POSTs { event: "scan.completed"|"scan.failed", sentAt, data: { projectId, externalId, scan } } with header X-ProjectLens-Signature: sha256=<HMAC-SHA256 of the raw request body>. The key is the organization's webhook signing secret ("whsec_…"), created by an owner/admin in the VS Code extension (Cloud → API keys → Webhook signing secret) or via POST /webhook-secret with an admin key, and shown once. Store it server-side as PROJECTLENS_WEBHOOK_SECRET, compute the HMAC over the raw body (before JSON parsing), and compare in constant time before trusting the payload.

## Two different credentials
- PROJECTLENS_API_KEY ("plk_…") authenticates this app to ProjectLens.
- A repository token (GitHub "Contents: Read" or GitLab "read_repository"), passed as accessToken on POST/PATCH /projects, lets ProjectLens download a PRIVATE repository. It is not needed for public repositories. An existing GitHub/GitLab connection in this app does not give ProjectLens access.

## Polling and pagination
- After POST /projects/{id}/scans returns 202, take data.id and poll GET /scans/{id} every 3-5 s until data.status is "completed" or "failed" (most scans finish in under a minute). Stop after a timeout.
- GET /scans/{id}/findings uses limit/offset (pagination.total). GET /prompt-guard/events returns pagination.nextBefore; pass it as ?before= to get older events.
- Distinguish ProjectLens errors ({ error: { code, message } }) from errors in this app's own backend when showing messages.

## What to build
1. A typed server-side client module for the endpoints above with proper error handling.
2. A way to link a project in this app to a repository (POST /projects with externalId).
3. A project health view: scores, progress estimate and modules, top risks linking to code, technologies, and a trend chart.
4. An "Analyze" action that triggers a scan and handles 202/200(cached)/409/429.
5. Optional: AI insights on demand, labelled as AI-generated, rendered as plain text.
6. Optional: a Prompt Guard settings screen (policy editor) and a compliance view of flagged-prompt events and member coverage.
Follow this codebase's existing conventions, UI components and patterns.`;

  const webhookSample = `import { createHmac, timingSafeEqual } from 'node:crypto';

// PROJECTLENS_WEBHOOK_SECRET = your organization's signing secret (whsec_…)
export async function POST(req: Request) {
  const raw = await req.text(); // raw body: hash it before parsing JSON
  const expected = 'sha256=' + createHmac('sha256', process.env.PROJECTLENS_WEBHOOK_SECRET!).update(raw).digest('hex');
  const received = req.headers.get('x-projectlens-signature') ?? '';
  const ok = received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!ok) return new Response('invalid signature', { status: 401 });

  const { event, data } = JSON.parse(raw); // scan.completed | scan.failed
  // data.externalId → your project; data.scan.overview → scores and risks
  return new Response('ok');
}`;

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" href="#top" aria-label="ProjectLens Cloud home">
            <Image src="/logo.svg" alt="" width={30} height={30} priority />
            ProjectLens
          </a>
          <NavLinks />
          <ThemeToggle />
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow anim anim-1">
                <span className={`dot ${operational ? '' : 'dot-warn'}`} aria-hidden />
                {operational ? 'All systems operational' : 'Running without persistent storage'}
              </div>
              <h1 className="anim anim-2">
                Project health for your <span>team and tools</span>
              </h1>
              <p className="lead anim anim-3">
                Code quality, security, implementation progress and production readiness for every GitHub and GitLab project - available to your VS Code team and to any
                system through one REST API.
              </p>
              <div className="actions anim anim-4">
                <a className="btn btn-primary" href="#install">
                  <VSCodeIcon size={16} mono />
                  Install the extension
                </a>
                <a className="btn" href="#get-started">
                  Read the guide
                </a>
                <a className="btn" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                  OpenAPI spec
                </a>
              </div>
              <div className="platforms anim anim-5">
                <div className="platform-row" aria-label="Supported editors">
                  <span className="platform-label">Editors</span>
                  <span className="platform">
                    <VSCodeIcon size={16} /> VS Code
                  </span>
                  {OPEN_VSX_EDITORS.slice(0, 3).map((e) => (
                    <EditorTile key={e} name={e} />
                  ))}
                  <a className="platform-more" href="#install">
                    + more
                  </a>
                </div>
                <div className="platform-row" aria-label="Supported repositories">
                  <span className="platform-label">Repos</span>
                  <span className="platform">
                    <GitHubIcon size={16} /> GitHub
                  </span>
                  <span className="platform">
                    <GitLabIcon size={16} /> GitLab
                  </span>
                </div>
              </div>
            </div>
            <div className="terminal anim" role="img" aria-label="Example: requesting a project overview returns scores, progress and top risks">
              <div className="terminal-bar">
                <i />
                <i />
                <i />
                <span>Example · GET /projects/ext:pm-42</span>
              </div>
              <div className="terminal-body">
                {TERMINAL_LINES.map((line, i) => (
                  <div key={i} className="t-line" style={{ ['--i' as string]: i }}>
                    {line}
                  </div>
                ))}
                <div className="t-scores">
                  {HERO_SCORES.map(([label, value, color], i) => (
                    <div key={label} className="t-score">
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <div className="t-bar">
                        <b style={{ ['--w' as string]: `${value}%`, ['--fill' as string]: color, ['--i' as string]: i }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how-it-works">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">How it works</div>
              <h2>From developer workspace to project dashboard</h2>
              <p>Developers analyze code in VS Code; managers and tools read the same results through the API. No source code is stored.</p>
            </div>
            <div className="cards">
              <div className="card reveal">
                <div className="card-icons">
                  <div className="step-num">1</div>
                  <VSCodeIcon size={20} />
                </div>
                <h3>Sign in from VS Code</h3>
                <p>Install ProjectLens AI, open the Cloud page and sign in with GitHub{email ? ' or an email code' : ''}. Your team gets its own organization.</p>
              </div>
              <div className="card reveal reveal-delay-1">
                <div className="card-icons">
                  <div className="step-num">2</div>
                  <GitHubIcon size={20} />
                  <GitLabIcon size={20} />
                </div>
                <h3>Link projects</h3>
                <p>Link a workspace to a cloud project, then upload local scans or let the cloud scan the GitHub/GitLab repository at any commit.</p>
              </div>
              <div className="card reveal reveal-delay-2">
                <div className="card-icons">
                  <div className="step-num">3</div>
                  <PlugIcon size={20} className="icon-accent" />
                </div>
                <h3>Connect your tools</h3>
                <p>Create an API key and show scores, progress, risks and AI insights in your project-management tool - or trigger scans remotely.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="extension">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">The extension</div>
              <h2>Using ProjectLens in VS Code</h2>
              <p>
                Everything starts in the editor. Scans run locally, AI is optional, and the cloud is only used when you sign in. Pick a step to see that screen.
              </p>
            </div>
            <div className="reveal">
              <ExtensionTour />
            </div>
            <p className="tour-foot reveal">
              <span>Illustrations use sample data.</span>
            </p>
          </div>
        </section>

        <section className="section" id="install">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">Install</div>
              <h2>Available for VS Code, Cursor, Antigravity and more</h2>
              <p>The same free extension in every VS Code-based editor. Pick the store your editor uses.</p>
            </div>
            <div className="install-grid">
              <article className="install-card reveal">
                <header className="install-head">
                  <span className="install-icon install-icon-vscode">
                    <VSCodeIcon size={24} />
                  </span>
                  <div>
                    <h3>VS Code Marketplace</h3>
                    <p>For Visual Studio Code</p>
                  </div>
                  {versions.marketplace && <span className="version-badge">v{versions.marketplace}</span>}
                </header>
                <div className="editor-list">
                  <span className="editor-chip">
                    <VSCodeIcon size={16} /> VS Code
                  </span>
                </div>
                <div className="install-actions">
                  <a className="btn btn-primary" href={`vscode:extension/${EXTENSION_ID}`}>
                    <VSCodeIcon size={16} mono /> Open in VS Code
                  </a>
                  <a className="btn" href={MARKETPLACE_URL} target="_blank" rel="noreferrer">
                    View on Marketplace
                  </a>
                </div>
                <div className="install-alt">
                  <span>Or press Ctrl/Cmd+P in VS Code and run:</span>
                  <CopyChip value={`ext install ${EXTENSION_ID}`} label="VS Code install command" />
                </div>
              </article>
              <article className="install-card reveal reveal-delay-1">
                <header className="install-head">
                  <span className="install-icon">
                    <OpenVSXIcon size={24} />
                  </span>
                  <div>
                    <h3>Open VSX Registry</h3>
                    <p>For Cursor, Antigravity and other VS Code-based editors</p>
                  </div>
                  {versions.openVsx && <span className="version-badge">v{versions.openVsx}</span>}
                </header>
                <div className="editor-list">
                  {OPEN_VSX_EDITORS.map((e) => (
                    <EditorTile key={e} name={e} />
                  ))}
                </div>
                <div className="install-actions">
                  <a className="btn btn-primary" href={OPEN_VSX_URL} target="_blank" rel="noreferrer">
                    View on Open VSX
                  </a>
                </div>
                <div className="install-alt">
                  <span>
                    In your editor, open the Extensions view and search <strong>ProjectLens AI</strong>, or paste the ID:
                  </span>
                  <CopyChip value={EXTENSION_ID} label="extension ID" />
                </div>
              </article>
            </div>
            <p className="install-note reveal">
              <ShieldNoteIcon /> Prompt Guard protects Claude Code, Codex, Cursor, GitHub Copilot and Antigravity, whichever editor you install ProjectLens in.
            </p>
          </div>
        </section>

        <section className="section" id="get-started">
          <div className="container split">
            <div>
              <div className="section-head reveal">
                <div className="kicker">Get started</div>
                <h2>Step-by-step guide</h2>
                <p>About five minutes from install to your first overview in an external tool.</p>
              </div>
              <ol className="steps reveal">
                <li>
                  <h3 className="inline-icon">
                    <VSCodeIcon size={16} /> Install the extension
                  </h3>
                  <p>
                    Install <a href={MARKETPLACE} target="_blank" rel="noreferrer">ProjectLens AI</a> from the VS Code Marketplace, or from <a href={OPEN_VSX_URL} target="_blank" rel="noreferrer">Open VSX</a> in Cursor, Antigravity and other editors (<a href="#install">install options</a>). Then click the ProjectLens icon in the Activity Bar.
                  </p>
                </li>
                <li>
                  <h3>Sign in to ProjectLens Cloud</h3>
                  <p>Open the dashboard’s <strong>Cloud</strong> page and sign in. A personal organization is created on first sign-in; create more for clients or teams.</p>
                </li>
                <li>
                  <h3>Link your workspace</h3>
                  <p>
                    Choose <strong>Link to cloud project</strong>. The repository is detected from the Git remote. Add a read-only token (GitHub <em>Contents: Read</em> or GitLab{' '}
                    <em>read_repository</em>) to enable cloud scans of private repositories.
                  </p>
                </li>
                <li>
                  <h3>Upload or scan</h3>
                  <p>Use <strong>Upload latest scan</strong> after a local scan, enable automatic uploads, or <strong>Run cloud scan</strong> to analyze the repository on the server.</p>
                </li>
                <li>
                  <h3>Invite your team</h3>
                  <p>Invite teammates by email; they join automatically when they sign in with that address. Roles: owner, admin, member.</p>
                </li>
                <li>
                  <h3>Create an API key</h3>
                  <p>
                    In VS Code, open the ProjectLens dashboard → <strong>Cloud → API keys</strong> (owners and admins only) and create a key with <code>read</code>, <code>scan</code> and <code>ai</code>. It is shown once - store it in your tool’s
                    server environment as <code>PROJECTLENS_API_KEY</code>.
                  </p>
                </li>
                <li>
                  <h3>Optional: AI insights</h3>
                  <p>Add your organization’s Groq, OpenAI, Gemini or Claude key in <strong>Cloud → Cloud AI keys</strong>. It is encrypted and used only for your organization.</p>
                </li>
              </ol>
            </div>
            <div className="stack reveal reveal-delay-1">
              <CodeBlock title="Quickstart · curl" code={curlSample} />
              <CodeBlock title="Integration · TypeScript (server)" code={tsSample} />
              <div className="callout">
                <strong>Tip:</strong> register projects with your own tool’s id as <code>externalId</code>, then address them as <code>/projects/ext:&lt;id&gt;</code> - no
                ProjectLens ids to store.
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="build-with-ai">
          <div className="container split">
            <div>
              <div className="section-head reveal">
                <div className="kicker">Build with AI</div>
                <h2 className="inline-icon">
                  <SparklesIcon size={22} className="icon-accent" /> Prompt for AI coding tools
                </h2>
                <p>
                  Using Claude Code, Cursor, GitHub Copilot or another AI assistant? Paste this prompt into it from your app’s repository. It describes the API, the data and
                  what to build - your assistant adapts it to your codebase.
                </p>
              </div>
              <ol className="steps reveal">
                <li>
                  <h3>Create an API key</h3>
                  <p>
                    VS Code → ProjectLens → <strong>Cloud → API keys</strong> (scopes <code>read</code>, <code>scan</code>, <code>ai</code>).
                  </p>
                </li>
                <li>
                  <h3>Set environment variables</h3>
                  <p>
                    Add <code>PROJECTLENS_API_URL</code> and <code>PROJECTLENS_API_KEY</code> to your app’s server environment (never commit the key).
                  </p>
                </li>
                <li>
                  <h3>Paste the prompt</h3>
                  <p>Copy the prompt into your AI coding tool, review the generated code, and test with one linked project.</p>
                </li>
              </ol>
            </div>
            <div className="reveal reveal-delay-1">
              <CodeBlock title="Prompt · copy into your AI coding tool" code={aiPrompt} tall />
            </div>
          </div>
        </section>

        <section className="section" id="authentication">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">Authentication</div>
              <h2>Keys, sessions and scopes</h2>
              <p>
                Send <code>Authorization: Bearer &lt;token&gt;</code> with every request. Base URL: <code>{base}</code>
              </p>
            </div>
            <div className="table-wrap reveal">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Used by</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="path">plk_…</td>
                    <td>Integrations (PM tools, scripts, CI)</td>
                    <td>
                      One organization, limited to its scopes: <span className="scope">read</span> · <span className="scope">scan</span> · <span className="scope">ai</span> ·{' '}
                      <span className="scope">audit</span> (Prompt Guard reports) · <span className="scope">admin</span> (manage keys and policies)
                    </td>
                  </tr>
                  <tr>
                    <td className="path">pls_…</td>
                    <td>The VS Code extension (user session)</td>
                    <td>
                      The user’s organizations, by role (member / admin / owner). Select one with <code>X-ProjectLens-Org</code>.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="callout callout-warn" style={{ marginTop: 16 }}>
              <strong>Keep keys on the server.</strong> Call the API from your backend (API routes, server actions, jobs) - never from browser code.
            </div>
            <div className="cred-grid reveal">
              <div className="cred">
                <span className="cred-tag">1</span>
                <div>
                  <h3>ProjectLens API key</h3>
                  <p>
                    <code>plk_…</code> - proves your integration may use your organization&apos;s data. Always required. Created in VS Code → ProjectLens → Cloud → API keys.
                  </p>
                </div>
              </div>
              <div className="cred">
                <span className="cred-tag">2</span>
                <div>
                  <h3>Repository token</h3>
                  <p>
                    Lets ProjectLens download a <strong>private</strong> repository for cloud scans: GitHub <em>Contents: Read</em> or GitLab <em>read_repository</em>, sent as{' '}
                    <code>accessToken</code>. Not needed for public repositories. A GitHub or GitLab connection in another tool does not give ProjectLens access.
                  </p>
                </div>
              </div>
            </div>
            <h3 className="sub-head reveal">Which scopes do I need?</h3>
            <div className="table-wrap reveal">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>You are building</th>
                    <th>Scopes</th>
                  </tr>
                </thead>
                <tbody>
                  {SCOPE_GUIDE.map(([what, scopes]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td className="path wrap">{scopes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="section" id="endpoints">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">Reference</div>
              <h2>Endpoints</h2>
              <p>
                All paths are relative to <code>/api/v1</code>. The complete schema is in the <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI 3.1 specification</a>.
              </p>
            </div>
            {GROUPS.map((g) => (
              <div key={g.title} className="endpoint-group">
                <div className="group-title">
                  <h3>{g.title}</h3>
                  <span>{g.note}</span>
                </div>
                <div className="table-wrap reveal">
                  <table className="stack-table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th>Scope</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.endpoints.map((ep) => (
                        <tr key={`${ep.method} ${ep.path}`}>
                          <td className="path">
                            <span className={`method m-${ep.method.toLowerCase()}`}>{ep.method}</span>
                            {ep.path}
                          </td>
                          <td>
                            <span className="scope">{ep.scope}</span>
                          </td>
                          <td className="muted">{ep.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="data">
          <div className="container split">
            <div>
              <div className="section-head reveal">
                <div className="kicker">Data</div>
                <h2>The project overview</h2>
                <p>
                  Every completed scan has an <code>overview</code> - the compact summary to display in dashboards (at <code>latestScan.overview</code> on a project).
                </p>
              </div>
              <div className="table-wrap reveal">
                <table>
                  <tbody>
                    {OVERVIEW_FIELDS.map(([field, desc]) => (
                      <tr key={field}>
                        <td className="path wrap">{field}</td>
                        <td className="muted">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="section-head reveal">
                <div className="kicker">Errors &amp; limits</div>
                <h2>Status codes</h2>
                <p>
                  Errors are <code>{'{ "error": { "code", "message", "details" } }'}</code>.
                </p>
              </div>
              <div className="table-wrap reveal">
                <table>
                  <tbody>
                    {STATUS_CODES.map(([code, desc]) => (
                      <tr key={code}>
                        <td className="path">{code}</td>
                        <td className="muted">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="callout" style={{ marginTop: 16 }}>
                <strong>Free plan, per organization:</strong> {l.projects} projects · {l.cloudScansPerDay} cloud scans, {l.uploadsPerDay} uploads and {l.aiInsightsPerDay} AI
                insights per 24 h · one scan per project per minute.
              </div>
              <h3 className="sub-head">Troubleshooting</h3>
              <div className="trouble reveal">
                {TROUBLESHOOTING.map(([q, a]) => (
                  <details key={q}>
                    <summary>{q}</summary>
                    <p>{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="webhooks">
          <div className="container split">
            <div>
              <div className="section-head reveal">
                <div className="kicker">Webhooks</div>
                <h2>Get notified when scans finish</h2>
                <p>
                  Pass <code>callbackUrl</code> (HTTPS) when triggering a scan. ProjectLens POSTs <code>scan.completed</code> or <code>scan.failed</code> with{' '}
                  <code>X-ProjectLens-Signature: sha256=…</code>, an HMAC-SHA256 of the raw body using your organization&apos;s signing secret.
                </p>
              </div>
              <ol className="steps compact">
                <li>
                  <h3>Create your signing secret</h3>
                  <p>
                    An owner or admin opens VS Code → ProjectLens → <strong>Cloud → API keys → Webhook signing secret</strong> (or calls <code>POST /webhook-secret</code> with an admin key).
                    It starts with <code>whsec_</code> and is shown once. Each organization has its own secret.
                  </p>
                </li>
                <li>
                  <h3>Store it in your backend</h3>
                  <p>
                    Save it as <code>PROJECTLENS_WEBHOOK_SECRET</code> next to your API key. Prompt Guard alerts (<code>prompt.flagged</code>) are signed the same way.
                  </p>
                </li>
                <li>
                  <h3>Verify every request</h3>
                  <p>Hash the raw body before parsing JSON and compare in constant time. Rotating the secret takes effect immediately.</p>
                </li>
              </ol>
              <p className="muted">
                Without webhooks, poll <code>GET /scans/{'{id}'}</code> every 3 to 5 seconds until the status is <code>completed</code> or <code>failed</code>.
              </p>
            </div>
            <div className="reveal reveal-delay-1">
              <CodeBlock title="Verify a webhook · Next.js route" code={webhookSample} />
            </div>
          </div>
        </section>

        <section className="section" id="security">
          <div className="container">
            <div className="section-head reveal">
              <div className="kicker">Security &amp; privacy</div>
              <h2>Built to protect your code</h2>
            </div>
            <ul className="checklist reveal">
              <li>
                <strong>No source code stored.</strong> Repository snapshots are deleted after each scan; uploads contain results only.
              </li>
              <li>
                <strong>Secrets redacted.</strong> Evidence is redacted before storage and before any AI request.
              </li>
              <li>
                <strong>Isolated organizations.</strong> Every query is scoped to your organization.
              </li>
              <li>
                <strong>Encrypted credentials.</strong> Repository tokens and AI keys use AES-256-GCM and are never returned.
              </li>
              <li>
                <strong>Hashed keys.</strong> API keys, sessions and sign-in codes are stored only as SHA-256 hashes.
              </li>
              <li>
                <strong>Your AI key, your data.</strong> AI insights use your organization’s own provider key.
              </li>
            </ul>
          </div>
        </section>
      </main>

      <ScrollEffects />
      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <a className="brand" href="#top">
              <Image src="/logo.svg" alt="" width={24} height={24} />
              ProjectLens
            </a>
            <div className="footer-links">
              <a href={MARKETPLACE} target="_blank" rel="noreferrer">
                <VSCodeIcon size={14} /> VS Code extension
              </a>
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                <BracesIcon size={14} /> OpenAPI
              </a>
              <a href="/api/v1/health" target="_blank" rel="noreferrer">
                <ActivityIcon size={14} /> Status
              </a>
              <a href={GITHUB} target="_blank" rel="noreferrer">
                <GitHubIcon size={14} /> GitHub
              </a>
            </div>
          </div>
          <p className="credit">
            Designed and Developed by{' '}
            <a href={LINKEDIN} target="_blank" rel="noreferrer">
              Sandeepa Mallawarachchi
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
