# ProjectLens API

ProjectLens API is a REST API for analyzing GitHub and GitLab repositories remotely. It runs the same analysis engine as the ProjectLens VS Code extension and reports:

- technologies
- code quality
- security
- implementation progress
- production readiness

It can also produce optional AI insights using a Groq, OpenAI, Gemini or Claude key kept on the server.

It is designed to be called from other systems, such as a project-management tool. Typical uses are listing projects with their health scores, triggering an analysis, showing trends, and opening findings directly at the right line on GitHub or GitLab.

```
Your system ──HTTPS + API key──▶ ProjectLens API (Vercel) ──▶ GitHub / GitLab (download commit snapshot)
                                        │
                                        └──▶ Supabase Postgres (projects, scan results, insights)
```

**How a scan works:**
1. The API resolves the branch to a commit.
2. It downloads that commit's tarball (no Git history) and extracts it to temporary storage.
3. It runs the analysis and stores the results: scores, redacted findings and links.
4. It deletes the files.

No source code is stored. If the commit was already scanned, the stored result is returned without downloading anything.

## Deploy (Vercel + Supabase)

1. **Create the database.** Create a Supabase project, open **SQL Editor**, and run `supabase/schema.sql`. Then copy the project URL and the **service_role** key from **Project Settings → API**.
2. **Create a Vercel project** from this repository:
   - **Root Directory:** `server`
   - Keep **"Include files outside the root directory in the Build Step"** enabled (the default). The build copies the shared engine from `../src`.
   - The framework is detected as Next.js automatically.
3. **Set environment variables** in Vercel (see `.env.example`):
   - `PROJECTLENS_ADMIN_KEY`: a long random string (`openssl rand -base64 32`).
   - `PROJECTLENS_ENCRYPTION_KEY`: generate with `openssl rand -base64 32`. Changing it later makes stored repository tokens unreadable.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   - Optional: `AI_PROVIDER` plus that provider's key (`GROQ_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`).
   - Optional: `PROJECTLENS_WEBHOOK_SECRET` and `WEBHOOK_ALLOWED_HOSTS`.
4. **Deploy**, then check `https://<your-api>.vercel.app/api/v1/health`.
5. **Create a scoped key for your app** with the admin key:
   ```bash
   curl -X POST https://<your-api>.vercel.app/api/v1/keys \
     -H "Authorization: Bearer $PROJECTLENS_ADMIN_KEY" -H "content-type: application/json" \
     -d '{"name":"pm-tool","scopes":["read","scan","ai"]}'
   ```
   The response includes `key` (`plk_…`) **once**. Store it in your app's server environment.

Scans and AI routes run for up to 300 s (`maxDuration`). Typical repositories finish in seconds.

## Repository access tokens

| Host | Token | Permissions |
|---|---|---|
| GitHub | Fine-grained personal access token or GitHub App token | **Contents: Read** on the repository |
| GitLab | Project, group or personal access token | **read_repository** (add `read_api` for some self-hosted setups) |

Public repositories need no token. Tokens are encrypted with AES-256-GCM, never returned by the API, and used only to call the GitHub or GitLab API.

## API

Base URL: `https://<your-api>/api/v1`. Every request except `/health` and `/openapi.json` needs `Authorization: Bearer <key>`. The full OpenAPI spec is at `/api/v1/openapi.json`.

| Method & path | Scope | Purpose |
|---|---|---|
| `POST /projects` | scan | Register a repository: `name`, `provider` (`github` or `gitlab`), `repository` (URL or `owner/repo`), optional `ref`, `accessToken`, `baseUrl`, `externalId`, `metadata` |
| `GET /projects` | read | All projects with their latest overview (`?externalId=` to filter) |
| `GET /projects/{id}` | read | Overview, latest scan, and a score trend over the last 20 scans |
| `PATCH /projects/{id}` | scan | Change `name`, `ref`, `accessToken` (`null` removes it), `externalId` or `metadata` |
| `DELETE /projects/{id}` | admin | Delete the project and its history |
| `POST /projects/{id}/scans` | scan | Trigger a scan. `{ "mode": "full", "wait": false, "force": false, "ref": "main", "callbackUrl": "https://…" }` |
| `GET /projects/{id}/scans` | read | Scan history |
| `GET /scans/{id}` | read | Status, overview, score explanations (checks and caps), modules |
| `GET /scans/{id}/findings` | read | Findings, paginated. Filters: `severity` (minimum), `category`, `status`, `file`, `includeTests`, `limit`, `offset` |
| `GET /scans/{id}/report?format=markdown\|json` | read | Full report |
| `POST /scans/{id}/insights` | ai | AI analysis: `{ "task": "projectAssessment" }` (also `architectureSummary`, `improvements`, `securityConcerns`, `incompletePatterns`, `explainFinding` + `findingId`, `reviewModule` + `moduleId`, `reviewFile` + `file`). Optional `provider` and `model` |
| `GET /scans/{id}/insights`, `GET /projects/{id}/insights` | read | Stored AI insights |
| `POST /keys`, `GET /keys`, `DELETE /keys/{id}` | admin | Manage API keys |

**Using your own project IDs:** `{id}` can be the ProjectLens UUID or `ext:<externalId>`. If you register projects with your tool's ID as `externalId`, you never need to store ProjectLens IDs.

**Scan responses:**

| Status | Meaning |
|---|---|
| `202` | Accepted; the scan runs in the background. Poll `GET /scans/{id}` or use `callbackUrl`. |
| `200` | Finished (`wait: true`), or `cached: true` when the commit was already scanned. |
| `409` | A scan is already running for this project. |
| `429` | Rate limited (`SCAN_MIN_INTERVAL_SECONDS`, default 60 s). |

**Errors** always have the shape `{ "error": { "code": "…", "message": "…", "details": … } }`.

### Webhooks

Pass `callbackUrl` (HTTPS) when triggering a scan to receive `scan.completed` or `scan.failed`:

```http
POST <callbackUrl>
X-ProjectLens-Event: scan.completed
X-ProjectLens-Signature: sha256=<HMAC-SHA256 of the raw body with PROJECTLENS_WEBHOOK_SECRET>

{ "event": "scan.completed", "sentAt": "…", "data": { "projectId": "…", "externalId": "pm-42", "scan": { …overview… } } }
```

Verify the signature before trusting the payload.

## Example: integrating a project-management tool (Next.js / Node)

Call the API **from your server** (API routes or server actions), never from the browser, so the key stays secret:

```ts
// lib/projectlens.ts (server-only)
const BASE = process.env.PROJECTLENS_API_URL!; // https://<your-api>.vercel.app/api/v1
const KEY = process.env.PROJECTLENS_API_KEY!;  // plk_… with read/scan/ai scopes

async function pl<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...init.headers },
    cache: 'no-store'
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `ProjectLens ${res.status}`);
  return body as T;
}

// Link a PM project to its repository (once).
export const linkRepository = (pmProjectId: string, name: string, repoUrl: string, token?: string) =>
  pl('/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      provider: repoUrl.includes('gitlab') ? 'gitlab' : 'github',
      repository: repoUrl,
      accessToken: token,
      externalId: pmProjectId
    })
  });

// Overview for the PM dashboard: scores, progress, top risks, technologies, trend.
export const getOverview = (pmProjectId: string) => pl<{ data: any }>(`/projects/ext:${pmProjectId}`);

// "Analyze now" button. Returns quickly; the scan finishes in the background.
export const analyze = (pmProjectId: string) =>
  pl<{ data: { id: string; status: string }; cached: boolean }>(`/projects/ext:${pmProjectId}/scans`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'full' })
  });

export const getScan = (scanId: string) => pl<{ data: any }>(`/scans/${scanId}`);
export const getRisks = (scanId: string) => pl<{ data: any[] }>(`/scans/${scanId}/findings?severity=high&limit=20`);
export const aiAssessment = (scanId: string) =>
  pl<{ data: any }>(`/scans/${scanId}/insights`, { method: 'POST', body: JSON.stringify({ task: 'projectAssessment' }) });
```

**Useful fields for a PM view** (`GET /projects/ext:{id}` → `data.latestScan.overview`):

| Field | Contents |
|---|---|
| `scores.{quality,security,implementation,readiness}.score` | 0–100, or `null` when not assessed |
| `progress.estimate`, `progress.label`, `progress.modules[]` | Status and completion per module |
| `findings.bySeverity`, `topRisks[]` | Each risk includes `url` to the line on GitHub/GitLab |
| `technologies[]`, `recommendedActions[]` | Detected stack and suggested next steps |
| `data.trend[]` | Score history for charts |

## Local development

```bash
cd server
cp .env.example .env.local    # fill PROJECTLENS_ADMIN_KEY and PROJECTLENS_ENCRYPTION_KEY
npm install
npm run dev                   # http://localhost:3000; uses in-memory storage without Supabase
npm test                      # API tests with mocked GitHub/GitLab and AI providers
```

With `ALLOW_LOCAL_REPOS=true`, you can register `{ "provider": "local", "repository": "/abs/path" }` to scan a folder on your machine. Never enable this in production.

## Security notes

- **Access control:** API keys are stored as SHA-256 hashes, and scopes are enforced per route. Supabase tables have RLS enabled with no public policies, so only the service-role key (server-only) can access them.
- **Secret handling:** repository tokens are encrypted at rest. Finding evidence is redacted, and AI context goes through the same redaction and file exclusions as the extension. Gitleaks and repository scripts are never executed.
- **Archive extraction:** archives are streamed with size limits. Symlinks, hard links and absolute or `..` paths are skipped.
- **Outbound requests:** self-hosted GitLab URLs and webhook URLs must be HTTPS and are blocked for private or loopback hosts. Use `GITLAB_ALLOWED_HOSTS` and `WEBHOOK_ALLOWED_HOSTS` to allow-list hosts.
- **AI requests:** calling the AI endpoint is the consent to send redacted excerpts to the configured provider.

## Limitations

- In-memory storage (when Supabase isn't configured) is per server instance and is lost on redeploys. Use Supabase in production.
- Background scans use Next.js `after()`, which runs within the same function invocation (up to `maxDuration`). There is no separate queue. A scan interrupted by a platform timeout stays `running` for 15 minutes, after which a new scan is allowed.
- Repositories larger than `MAX_REPO_MB` (default 200 MB of source) are rejected.
