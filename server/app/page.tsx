import Image from 'next/image';
import { env } from '@/lib/env';
import { emailEnabled } from '@/lib/email';
import { limits } from '@/lib/quotas';
import { CodeBlock } from './components/CodeBlock';
import { GitHubIcon, GitLabIcon, PlugIcon, SparklesIcon, VSCodeIcon } from './components/BrandIcons';
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
      { method: 'DELETE', path: '/keys/{id}', scope: 'admin', description: 'Revoke an API key' }
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
  ['429', 'Rate limit or plan quota reached - see error.details']
];

const TERMINAL_LINES = [
  <><span className="t-prompt">$</span> curl $PL_API/projects/ext:pm-42 -H <span className="t-str">&quot;Authorization: Bearer plk_…&quot;</span></>,
  <span className="t-status">HTTP/2 200</span>,
  <>{'{'} <span className="t-key">&quot;latestScan&quot;</span>: {'{'} <span className="t-key">&quot;overview&quot;</span>: {'{'}</>,
  <>  <span className="t-key">&quot;primaryFramework&quot;</span>: <span className="t-str">&quot;Next.js&quot;</span>,</>,
  <>  <span className="t-key">&quot;findings&quot;</span>: {'{'} <span className="t-key">&quot;critical&quot;</span>: <span className="t-num">0</span>, <span className="t-key">&quot;high&quot;</span>: <span className="t-num">2</span> {'}'},</>,
  <>  <span className="t-key">&quot;progress&quot;</span>: {'{'} <span className="t-key">&quot;estimate&quot;</span>: <span className="t-num">78</span>, <span className="t-key">&quot;modules&quot;</span>: <span className="t-muted">[…]</span> {'}'},</>,
  <>  <span className="t-key">&quot;topRisks&quot;</span>: <span className="t-muted">[ {'{'} &quot;title&quot;: &quot;SQL built from…&quot;, &quot;url&quot;: &quot;…#L42&quot; {'}'} ]</span></>,
  <>{'}'} {'}'} {'}'}<span className="t-cursor" /></>
];

const HERO_SCORES: [string, number, string][] = [
  ['Security', 86, 'var(--green)'],
  ['Quality', 74, 'var(--accent)'],
  ['Progress', 78, 'var(--purple)'],
  ['Readiness', 69, 'var(--orange)']
];

export default async function Home() {
  // Examples always show the public production URL, regardless of where the page is served from.
  const base = `${(process.env.PROJECTLENS_PUBLIC_URL || 'https://projectlensai.vercel.app').replace(/\/+$/, '')}/api/v1`;
  const e = env();
  const l = limits();
  const operational = e.storage === 'supabase';
  const email = emailEnabled();

  const curlSample = `# Your organization API key (create it in VS Code → ProjectLens → Cloud → API keys)
export PL_KEY=plk_your_key
export PL_API=${base}

# 1. Register a project (use your own tool's id as externalId)
curl -X POST $PL_API/projects -H "Authorization: Bearer $PL_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"Customer Portal","provider":"github","repository":"acme/portal","externalId":"pm-42","accessToken":"github_pat_…"}'

# 2. Run a cloud scan (returns 202; poll GET /scans/{id})
curl -X POST $PL_API/projects/ext:pm-42/scans -H "Authorization: Bearer $PL_KEY" \\
  -H "content-type: application/json" -d '{"mode":"full"}'

# 3. Read the overview: scores, progress, top risks, trend
curl $PL_API/projects/ext:pm-42 -H "Authorization: Bearer $PL_KEY"`;

  const tsSample = `// Server-side only - never expose the key to the browser.
const BASE = process.env.PROJECTLENS_API_URL!; // ${base}
const KEY = process.env.PROJECTLENS_API_KEY!;  // plk_…

async function projectlens<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(\`\${BASE}\${path}\`, {
    ...init,
    headers: { authorization: \`Bearer \${KEY}\`, 'content-type': 'application/json', ...init.headers },
    cache: 'no-store'
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? \`ProjectLens \${res.status}\`);
  return body.data as T;
}

const overview = await projectlens<any>('/projects/ext:pm-42');
console.log(overview.latestScan?.overview.scores.security.score);`;

  const aiPrompt = `Integrate the ProjectLens Cloud API into this application.

## About ProjectLens
ProjectLens analyzes GitHub/GitLab projects and reports code quality, security, implementation progress and production readiness, plus optional AI insights. Use it to show project health in this app and to trigger analyses remotely.

## Connection
- Base URL: ${base}  (env: PROJECTLENS_API_URL)
- Auth header: Authorization: Bearer <PROJECTLENS_API_KEY>  (an organization API key "plk_…" with scopes read, scan, ai)
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

## overview fields (latestScan.overview)
scores.{quality,security,implementation,readiness}.{score,grade,verdict}; findings.{total,bySeverity,needsReview}; progress.{label,estimate,modules[{name,status,completion}]}; technologies[]; topRisks[{title,severity,file,line,url}]; recommendedActions[{title,detail,priority}]

## Optional webhooks
Send callbackUrl (HTTPS) when triggering a scan. ProjectLens POSTs { event: "scan.completed"|"scan.failed", data: { externalId, scan } } with header X-ProjectLens-Signature: sha256=<HMAC-SHA256 of the raw body using PROJECTLENS_WEBHOOK_SECRET>. Verify with a constant-time comparison before trusting it.

## What to build
1. A typed server-side client module for the endpoints above with proper error handling.
2. A way to link a project in this app to a repository (POST /projects with externalId).
3. A project health view: scores, progress estimate and modules, top risks linking to code, technologies, and a trend chart.
4. An "Analyze" action that triggers a scan and handles 202/200(cached)/409/429.
5. Optional: AI insights on demand, labelled as AI-generated, rendered as plain text.
Follow this codebase's existing conventions, UI components and patterns.`;

  const webhookSample = `import { createHmac, timingSafeEqual } from 'node:crypto';

export async function POST(req: Request) {
  const raw = await req.text();
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
            ProjectLens <small>Cloud API</small>
          </a>
          <NavLinks />
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
                <a className="btn btn-primary" href={MARKETPLACE} target="_blank" rel="noreferrer">
                  <VSCodeIcon size={16} mono />
                  Install the VS Code extension
                </a>
                <a className="btn" href="#get-started">
                  Read the guide
                </a>
                <a className="btn" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                  OpenAPI spec
                </a>
              </div>
              <div className="platforms anim anim-5" aria-label="Supported platforms">
                <span>Works with</span>
                <span className="platform">
                  <VSCodeIcon size={16} /> VS Code
                </span>
                <span className="platform">
                  <GitHubIcon size={16} /> GitHub
                </span>
                <span className="platform">
                  <GitLabIcon size={16} /> GitLab
                </span>
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
                    Install <a href={MARKETPLACE} target="_blank" rel="noreferrer">ProjectLens AI</a> from the VS Code Marketplace and click the ProjectLens icon in the Activity Bar.
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
                      <span className="scope">admin</span> (manage keys)
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
                  Pass <code>callbackUrl</code> (HTTPS) when triggering a scan. ProjectLens POSTs <code>scan.completed</code> or <code>scan.failed</code>, signed with{' '}
                  <code>X-ProjectLens-Signature: sha256=…</code> (HMAC-SHA256 of the raw body with the shared webhook secret).
                </p>
              </div>
              <p className="muted">
                Without webhooks, poll <code>GET /scans/{'{id}'}</code> every few seconds until the status is <code>completed</code> or <code>failed</code>.
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
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI</a>
              <a href="/api/v1/health">Status</a>
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
