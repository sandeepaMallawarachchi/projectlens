# ProjectLens API (ProjectLens Cloud)

ProjectLens Cloud is a hosted, multi-tenant REST API that powers ProjectLens Cloud. It analyzes GitHub and GitLab repositories with the same engine as the ProjectLens VS Code extension, and stores scan results uploaded from the extension. Results cover:

- technologies
- code quality
- security
- implementation progress
- production readiness

It can also produce AI insights using each organization's own AI key.

Users sign in from the VS Code extension (**ProjectLens → Cloud**) with GitHub or a 6-digit email code. Each user belongs to one or more **organizations** (teams). Projects, scans, API keys and AI keys belong to an organization, and organizations are fully isolated from each other. A project-management tool (or any other system) connects with an **organization API key** created in the extension.

```
VS Code extension ──session (pls_…)──▶ ProjectLens Cloud API (Vercel) ──▶ GitHub / GitLab (commit snapshots)
PM tool / scripts ──API key (plk_…)──▶          │
                                                └──▶ Supabase Postgres (orgs, users, projects, scans, insights, keys)
```

## Who holds which secret

| Secret | Holder | Purpose |
|---|---|---|
| `PROJECTLENS_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **You (server only)** | Encryption at rest and database access. Never share. |
| `PROJECTLENS_ADMIN_KEY` | **You (server only)** | Platform operations; requires `X-ProjectLens-Org`. Not for customers. |
| `RESEND_API_KEY` | **You (server only)** | Email sign-in codes and invitations (optional). |
| Session token `pls_…` | Each user (stored in VS Code SecretStorage) | The extension's access to their organizations |
| API key `plk_…` | Each organization (created in the extension) | Integrations such as a PM tool |
| AI provider keys | Each organization (set in the extension) | Server-side AI insights for that organization, encrypted |
| Repository tokens | Each project | Cloud scans of private repositories, encrypted |

## Deploy or upgrade (Vercel + Supabase)

1. **Database:**
   - **New database:** run `supabase/schema.sql` in the Supabase SQL editor.
   - **Existing v0.1 database** (single-tenant, from the first deployment): run `supabase/migrations/002_multitenant.sql` instead. Existing projects and keys move into an organization called "Legacy workspace".
   - **Existing v0.2 database:** run `supabase/migrations/003_prompt_guard.sql` to add Prompt Guard (safe to run more than once).
2. **Vercel project:** set **Root Directory** to `server` and keep "Include files outside the root directory" enabled.
3. **Environment variables** (see `.env.example`):
   - **Required:** `PROJECTLENS_ADMIN_KEY`, `PROJECTLENS_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - **Email sign-in:** `RESEND_API_KEY` and `EMAIL_FROM`, with a domain verified in Resend. Without them, only GitHub sign-in is offered.
   - **Optional:** webhooks (`PROJECTLENS_WEBHOOK_SECRET`, `WEBHOOK_ALLOWED_HOSTS`) and free-plan limits (`FREE_MAX_*`).
   - **Server AI keys** (`GROQ_API_KEY`, …) are only used when `ALLOW_SERVER_AI_KEYS=true`. By default, organizations bring their own keys.
4. **Deploy**, then check `GET /api/v1/health`. It should show `"storage":"supabase"` and which sign-in methods are enabled.

## File size limits

Cloud scans download and analyze eligible source files up to **10 MB each** by default (`MAX_FILE_KB=10240`). The archive and extracted-source total remain limited to 200 MB (`MAX_REPO_MB=200`). The VS Code extension uses the same default through `projectlens.scan.maxFileSizeKb`. Explicit server or VS Code settings override these defaults.

For an existing Vercel deployment, raise any existing `MAX_FILE_KB=512` override to `10240` (or remove it to use the default), then redeploy. Run Analyze again: completed reports that skipped files under a smaller limit are regenerated instead of returned from the commit cache. Rate limits and quotas still apply. Generated folders and binary files remain excluded from source analysis.

## Getting started (for users)

1. In VS Code, install **ProjectLens AI** and open **ProjectLens → Cloud**.
2. Sign in with GitHub or email. A personal organization is created on first sign-in.
3. **Link this workspace:**
   - This creates a cloud project from the Git remote, or links an existing project.
   - Optionally add a read-only repository token so the server can run cloud scans.
   - Then **Upload latest scan** or **Run cloud scan**.
4. **Team:** invite teammates by email. They join automatically when they sign in with that email.
5. **API keys:** create a key (scopes `read`, `scan`, `ai`) for the PM tool.
6. **Cloud AI keys:** add the organization's Groq, OpenAI, Gemini or Claude key so integrations can request AI insights.

## Authentication

Send `Authorization: Bearer <token>` with one of:
- **`plk_…` organization API key:** for integrations. It is scoped to its own organization only, with scopes `read`, `scan`, `ai` and `admin` (manage keys).
- **`pls_…` user session:** from `POST /auth/github` or `POST /auth/email/verify`. Add `X-ProjectLens-Org: <orgId>` to choose the organization; the default is the user's first one.

  | Role | Permissions |
  |---|---|
  | `member` | read, scan, ai |
  | `admin`, `owner` | Also manage members, invitations, API keys and AI keys |
  | `owner` | Also manage other owners |

## API overview

Base URL: `https://<your-api>/api/v1`. The full spec is at `/api/v1/openapi.json`.

**Accounts** (no auth, or session):
- `GET /auth/config`
- `POST /auth/github`, `POST /auth/email/start`, `POST /auth/email/verify`, `POST /auth/logout`
- `GET /me`

**Organizations** (session):
- `GET /orgs`, `POST /orgs`, `GET /orgs/{id}`, `PATCH /orgs/{id}`
- `GET /orgs/{id}/members`, `PATCH /orgs/{id}/members/{userId}`, `DELETE /orgs/{id}/members/{userId}`
- `GET /orgs/{id}/invitations`, `POST /orgs/{id}/invitations`, `DELETE /orgs/{id}/invitations/{invId}`
- `GET /orgs/{id}/ai-keys`, `PUT /orgs/{id}/ai-keys/{provider}`, `DELETE /orgs/{id}/ai-keys/{provider}`, `PUT /orgs/{id}/ai-settings`
- `GET /orgs/{id}/usage`

**Organization resources** (API key or session):

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /projects` (`?externalId=`) | read | Projects with their latest overview |
| `POST /projects` | scan | Register a project: `provider` is `github`, `gitlab` or `none` (uploads only); also `repository`, optional `accessToken`, `externalId`, `ref`, `baseUrl` |
| `GET` / `PATCH` / `DELETE /projects/{id}` | read / scan / admin | `{id}` is a UUID or `ext:<externalId>`. The overview includes a score trend. |
| `POST /projects/{id}/scans` | scan | Cloud scan: `202` (background), `200` (`wait: true` or `cached: true`), `409` (already running), `429` (rate limit or quota) |
| `POST /projects/{id}/uploads` | scan | Upload a scan result from the extension (`{ result, commitSha?, branch? }`) |
| `GET /projects/{id}/scans`, `GET /scans/{id}` | read | History; detail with score explanations and modules |
| `GET /scans/{id}/findings` | read | Filters: `severity`, `category`, `status`, `file`, `includeTests`, `limit`, `offset` |
| `GET /scans/{id}/report?format=markdown\|json` | read | Full report |
| `POST /scans/{id}/insights` | ai | AI analysis using the organization's AI key (`ai_not_configured` if none is set) |
| `GET /usage` | read | Usage and plan limits |
| `GET` / `POST /keys`, `DELETE /keys/{id}` | admin | Organization API keys |
| `GET /prompt-guard/policy` | read | Prompt Guard policy |
| `PUT /prompt-guard/policy` | admin | Update any subset of `mode`, `notice`, `builtin`, `customRules`, `allowlist`, `webhookUrl` |
| `GET /prompt-guard/events` | audit | Flagged-prompt metadata. Filters: `since`, `userId`, `tool`, `limit` |
| `GET /prompt-guard/summary`, `GET /prompt-guard/members` | audit | Totals and member coverage |

**Prompt Guard** (session, used by the extension): `GET`/`PUT /orgs/{id}/prompt-guard/policy`, `POST /orgs/{id}/prompt-guard/consent`, `POST /orgs/{id}/prompt-guard/heartbeat`, `GET`/`POST /orgs/{id}/prompt-guard/events`, `GET /orgs/{id}/prompt-guard/members`, `GET /orgs/{id}/prompt-guard/summary`.

**Errors:** `{ "error": { "code", "message", "details"? } }`.

**Free-plan limits** (per organization; `quota_exceeded` when reached): 25 projects; per 24 h, 100 cloud scans, 200 uploads and 50 AI insights.

## Uploads from the extension

The extension uploads its local scan result (no source code). The server then:
1. Removes every local `file://` path, replacing it with a repository link at the uploaded commit when the project has a GitHub or GitLab repository.
2. Re-applies secret redaction to evidence.
3. Strips local paths from warnings.
4. Stores the result as a scan with `source: "upload"`.

## Prompt Guard

Owners and admins set a policy that the extension enforces on members' computers, for prompts sent to Claude Code, Codex, Cursor, GitHub Copilot and Antigravity.
- **Modes:** `off`, `optional` (each member accepts or declines) and `required`. In `required` mode, members' sessions get `403 prompt_guard_consent_required` on organization data until they accept the current notice.
- **Consent:** changing the mode or the notice increments `consentVersion`, so members accept again.
- **Privacy:** the server never receives prompt text. Events hold the tool, the result (`blocked`, `warned`, or `detected` when the tool cannot block), rule ids, categories, the workspace folder name and the time. Unknown fields are dropped.
- **Webhook:** set `webhookUrl` in the policy to receive signed `prompt.flagged` events for blocked and detected prompts.

## Webhooks

Pass `callbackUrl` (HTTPS) when triggering a cloud scan. The server POSTs `scan.completed` or `scan.failed` with the header `X-ProjectLens-Signature: sha256=<HMAC of the raw body with PROJECTLENS_WEBHOOK_SECRET>`.

## Local development

```bash
cd server
cp .env.example .env.local     # set PROJECTLENS_ADMIN_KEY and PROJECTLENS_ENCRYPTION_KEY; add EMAIL_DEV_LOG=true
npm install
npm run dev                    # in-memory storage without Supabase; sign-in codes are printed to the console
npm test                       # 27 tests: multi-tenant auth, sign-in, teams, uploads, cloud scans (mocked GitHub/GitLab/AI)
```

To use a local server from the extension, set `projectlens.cloud.apiUrl` to `http://localhost:3000/api/v1`.

## Security notes

- **Tenant isolation:** every tenant query includes the organization ID.
- **Tokens and secrets:**
  - API keys, session tokens and email codes are stored only as SHA-256 hashes.
  - Repository and AI keys are encrypted with AES-256-GCM and never returned.
  - GitHub sign-in tokens are verified with GitHub and never stored.
- **Email sign-in:** codes expire after 10 minutes, are locked after 5 wrong attempts, and limited to 5 codes per email per hour.
- **Database:** RLS is enabled on every table with no public policies, so only the server key can access data.
- **Scanning:** repository code and Gitleaks are never executed. Archive extraction rejects links and path traversal.
- **Outbound requests:** self-hosted GitLab and webhook URLs must be HTTPS and can't point to private hosts.
