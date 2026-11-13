import { AI_PROVIDER_IDS, AI_TASKS } from '@/engine/models/ai';

/** OpenAPI 3.1 description of the ProjectLens API (served at /api/v1/openapi.json). */
export function openApiSpec(origin: string) {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const ok = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
  const data = (schema: object) => ({ type: 'object', properties: { data: schema } });
  const errors = { '400': ref('ErrorResponse'), '401': ref('ErrorResponse'), '403': ref('ErrorResponse'), '404': ref('ErrorResponse') };
  const errorResponses = Object.fromEntries(Object.entries(errors).map(([code, schema]) => [code, { description: 'Error', content: { 'application/json': { schema } } }]));
  const projectId = { name: 'projectId', in: 'path', required: true, description: 'Project UUID, or `ext:<externalId>`', schema: { type: 'string' } };
  const scanId = { name: 'scanId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  const score = { type: 'object', properties: { score: { type: ['integer', 'null'] }, grade: { type: 'string' }, verdict: { type: 'string' } } };

  return {
    openapi: '3.1.0',
    info: {
      title: 'ProjectLens API',
      version: '0.4.0',
      description:
        'Hosted, multi-tenant analysis of GitHub/GitLab repositories: technologies, code quality, security, implementation progress, production readiness and AI insights (with each organization\'s own AI key). Authenticate with `Authorization: Bearer <token>`: an organization API key (`plk_…`, scopes read/scan/ai/audit/admin) for integrations, or a user session (`pls_…`, from GitHub or email sign-in) with optional `X-ProjectLens-Org` to select the organization.'
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key (plk_…) or the admin key' } },
      schemas: {
        ErrorResponse: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
        PromptPolicy: {
          type: 'object',
          properties: {
            version: { type: 'integer' },
            mode: { type: 'string', enum: ['off', 'optional', 'required'], description: '`optional`: members choose to opt in; `required`: members must accept before using organization data' },
            notice: { type: 'string', description: 'Shown to members before they accept' },
            consentVersion: { type: 'integer' },
            builtin: { type: 'object', description: 'Detector id → action. Detectors: secrets, pii.card, pii.email, pii.phone', additionalProperties: { type: 'string', enum: ['off', 'warn', 'redact', 'block'] } },
            customRules: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['term', 'regex'] }, pattern: { type: 'string' }, action: { type: 'string', enum: ['warn', 'redact', 'block'] } } } },
            allowlist: { type: 'array', items: { type: 'string' } },
            webhookUrl: { type: ['string', 'null'], description: 'Receives `prompt.flagged` (blocked and detected events)' },
            updatedAt: { type: ['string', 'null'] },
            updatedBy: { type: ['string', 'null'] }
          }
        },
        PromptPolicyUpdate: {
          type: 'object',
          description: 'Any subset of: mode, notice, builtin, customRules, allowlist, webhookUrl',
          properties: { mode: { type: 'string', enum: ['off', 'optional', 'required'] }, notice: { type: 'string' }, builtin: { type: 'object' }, customRules: { type: 'array', items: { type: 'object' } }, allowlist: { type: 'array', items: { type: 'string' } }, webhookUrl: { type: ['string', 'null'] } }
        },
        PromptEvent: {
          type: 'object',
          description: 'Metadata about a flagged prompt. Prompt text is never collected.',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            tool: { type: 'string', enum: ['claude', 'codex', 'cursor', 'copilot', 'antigravity'] },
            action: { type: 'string', enum: ['blocked', 'warned', 'detected'], description: '`detected`: the tool cannot block (GitHub Copilot)' },
            ruleIds: { type: 'array', items: { type: 'string' } },
            categories: { type: 'array', items: { type: 'string' } },
            project: { type: ['string', 'null'], description: 'Workspace folder name' },
            policyVersion: { type: 'integer' },
            occurredAt: { type: 'string', format: 'date-time' },
            receivedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreateProject: {
          type: 'object',
          required: ['name', 'provider', 'repository'],
          properties: {
            name: { type: 'string' },
            provider: { type: 'string', enum: ['github', 'gitlab', 'none'], description: '`none` = no repository access; results arrive as uploads from the VS Code extension' },
            repository: { type: 'string', description: '`owner/repo`, `group/subgroup/project`, or the repository URL' },
            ref: { type: 'string', description: 'Branch/tag/commit; default branch when omitted' },
            accessToken: { type: 'string', description: 'GitHub token with Contents: read, or GitLab token with read_repository. Encrypted at rest, never returned.' },
            baseUrl: { type: 'string', description: 'Self-hosted GitLab / GitHub Enterprise URL' },
            externalId: { type: 'string', description: 'Your system\'s project id (enables /projects/ext:<id>)' },
            metadata: { type: 'object' }
          }
        },
        Overview: {
          type: 'object',
          properties: {
            projectName: { type: 'string' },
            primaryFramework: { type: ['string', 'null'] },
            scores: { type: 'object', properties: { quality: score, security: score, implementation: score, readiness: score } },
            findings: { type: 'object', properties: { total: { type: 'integer' }, bySeverity: { type: 'object' }, security: { type: 'integer' }, quality: { type: 'integer' }, needsReview: { type: 'integer' } } },
            progress: { type: 'object', properties: { label: { type: 'string' }, estimate: { type: ['integer', 'null'] }, modules: { type: 'array', items: { type: 'object' } }, requirements: { type: ['array', 'null'] } } },
            technologies: { type: 'array', items: { type: 'object' } },
            topRisks: { type: 'array', items: { type: 'object' } },
            recommendedActions: { type: 'array', items: { type: 'object' } },
            coverage: { type: 'object' },
            warnings: { type: 'array', items: { type: 'string' } }
          }
        },
        Scan: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
            mode: { type: 'string', enum: ['quick', 'full'] },
            ref: { type: 'string' },
            commitSha: { type: 'string' },
            createdAt: { type: 'string' },
            finishedAt: { type: ['string', 'null'] },
            durationMs: { type: ['integer', 'null'] },
            error: { type: ['string', 'null'] },
            overview: { oneOf: [ref('Overview'), { type: 'null' }] }
          }
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            provider: { type: 'string' },
            repository: { type: 'string' },
            externalId: { type: ['string', 'null'] },
            hasAccessToken: { type: 'boolean' },
            latestScan: { oneOf: [ref('Scan'), { type: 'null' }] },
            trend: { type: 'array', items: { type: 'object' } }
          }
        },
        Finding: {
          type: 'object',
          properties: {
            id: { type: 'string' }, ruleId: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string' },
            confidence: { type: 'string' }, status: { type: 'string', enum: ['confirmed', 'needs-review'] }, file: { type: 'string' }, line: { type: 'integer' },
            url: { type: ['string', 'null'], description: 'Link to the line at the scanned commit' }, description: { type: 'string' }, recommendation: { type: 'string' }, evidence: { type: 'string', description: 'Redacted' }
          }
        },
        AIRequest: {
          type: 'object',
          required: ['task'],
          properties: {
            task: { type: 'string', enum: [...AI_TASKS] },
            provider: { type: 'string', enum: [...AI_PROVIDER_IDS] },
            model: { type: 'string' },
            findingId: { type: 'string' },
            moduleId: { type: 'string' },
            file: { type: 'string', description: 'Repository-relative path (reviewFile)' }
          }
        }
      }
    },
    paths: {
      '/health': { get: { summary: 'Health check', security: [], responses: { '200': ok({ type: 'object' }) } } },
      '/projects': {
        get: { summary: 'List projects with latest overview', parameters: [{ name: 'externalId', in: 'query', schema: { type: 'string' } }], responses: { '200': ok(data({ type: 'array', items: ref('Project') })), ...errorResponses } },
        post: { summary: 'Register a repository (scope: scan)', requestBody: { required: true, content: { 'application/json': { schema: ref('CreateProject') } } }, responses: { '201': ok(data(ref('Project')), 'Created'), ...errorResponses } }
      },
      '/projects/{projectId}': {
        parameters: [projectId],
        get: { summary: 'Project overview with latest scan and score trend', responses: { '200': ok(data(ref('Project'))), ...errorResponses } },
        patch: { summary: 'Update name, ref, token (null removes), externalId or metadata (scope: scan)', responses: { '200': ok(data(ref('Project'))), ...errorResponses } },
        delete: { summary: 'Delete project and its history (scope: admin)', responses: { '204': { description: 'Deleted' }, ...errorResponses } }
      },
      '/projects/{projectId}/scans': {
        parameters: [projectId],
        get: { summary: 'Scan history', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { '200': ok(data({ type: 'array', items: ref('Scan') })), ...errorResponses } },
        post: {
          summary: 'Trigger a remote scan (scope: scan)',
          description:
            'Returns 202 and runs in the background (poll GET /scans/{id} or pass callbackUrl for a signed webhook). `wait: true` blocks until done. If the commit was already scanned, the previous result is returned with `cached: true` unless `force: true`. 409 if a scan is running; 429 when rate limited.',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { mode: { type: 'string', enum: ['quick', 'full'], default: 'full' }, ref: { type: 'string' }, force: { type: 'boolean' }, wait: { type: 'boolean' }, callbackUrl: { type: 'string', description: 'HTTPS webhook receiving scan.completed / scan.failed, signed with the organization webhook secret (see /webhook-secret)' } } }
              }
            }
          },
          responses: { '200': ok(data(ref('Scan')), 'Completed or cached'), '202': ok(data(ref('Scan')), 'Accepted'), '409': errorResponses['404'], '429': errorResponses['404'], ...errorResponses }
        }
      },
      '/projects/{projectId}/insights': { parameters: [projectId], get: { summary: 'AI insights for the project', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })), ...errorResponses } } },
      '/scans/{scanId}': { parameters: [scanId], get: { summary: 'Scan status, overview, score explanations and modules', responses: { '200': ok(data(ref('Scan'))), ...errorResponses } } },
      '/scans/{scanId}/findings': {
        parameters: [scanId],
        get: {
          summary: 'Paginated findings',
          parameters: ['severity', 'category', 'status', 'file', 'includeTests', 'limit', 'offset'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
          responses: { '200': ok({ type: 'object', properties: { data: { type: 'array', items: ref('Finding') }, pagination: { type: 'object' } } }), ...errorResponses }
        }
      },
      '/scans/{scanId}/report': {
        parameters: [scanId],
        get: { summary: 'Full report (markdown or json)', parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['markdown', 'json'] } }], responses: { '200': { description: 'Report' }, ...errorResponses } }
      },
      '/scans/{scanId}/insights': {
        parameters: [scanId],
        get: { summary: 'AI insights for the scan', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })), ...errorResponses } },
        post: { summary: 'Run an AI analysis (scope: ai)', requestBody: { required: true, content: { 'application/json': { schema: ref('AIRequest') } } }, responses: { '201': ok(data({ type: 'object' }), 'Created'), ...errorResponses } }
      },
      '/keys': {
        get: { summary: 'List API keys (scope: admin)', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })), ...errorResponses } },
        post: {
          summary: 'Create an API key (scope: admin). The key is shown once.',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['read', 'scan', 'ai', 'audit', 'admin'] } } } } } } },
          responses: { '201': ok(data({ type: 'object' }), 'Created'), ...errorResponses }
        }
      },
      '/projects/{projectId}/uploads': {
        parameters: [projectId],
        post: {
          summary: 'Upload a scan result from the VS Code extension (scope: scan)',
          description: 'Body: `{ result: ScanResult, commitSha?, branch? }`. Local paths are removed and evidence is redacted again before storage.',
          responses: { '201': ok(data(ref('Scan')), 'Created'), ...errorResponses }
        }
      },
      '/usage': { get: { summary: 'Usage and plan limits of the caller\'s organization', responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/auth/config': { get: { summary: 'Available sign-in methods', security: [], responses: { '200': ok(data({ type: 'object' })) } } },
      '/auth/github': { post: { summary: 'Sign in with a GitHub OAuth token (returns a pls_ session)', security: [], responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/auth/email/start': { post: { summary: 'Email a 6-digit sign-in code', security: [], responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/auth/email/verify': { post: { summary: 'Verify the code (returns a pls_ session)', security: [], responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/auth/logout': { post: { summary: 'Revoke the current session', responses: { '204': { description: 'Signed out' } } } },
      '/me': { get: { summary: 'Current user and organizations (session)', responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/orgs': {
        get: { summary: 'Your organizations (session)', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })) } },
        post: { summary: 'Create an organization (session)', responses: { '201': ok(data({ type: 'object' }), 'Created') } }
      },
      '/orgs/{orgId}': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Organization', responses: { '200': ok(data({ type: 'object' })) } }, patch: { summary: 'Rename (admin)', responses: { '200': ok(data({ type: 'object' })) } } },
      '/orgs/{orgId}/members': { get: { summary: 'Members', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })) } } },
      '/orgs/{orgId}/members/{userId}': { patch: { summary: 'Change role (admin; owners manage owners)', responses: { '200': ok(data({ type: 'object' })) } }, delete: { summary: 'Remove member or leave', responses: { '204': { description: 'Removed' } } } },
      '/orgs/{orgId}/invitations': { get: { summary: 'Invitations (admin)', responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })) } }, post: { summary: 'Invite by email (admin); joins on next sign-in', responses: { '201': ok(data({ type: 'object' }), 'Created') } } },
      '/orgs/{orgId}/ai-keys': { get: { summary: 'AI providers configured for the organization (keys never returned)', responses: { '200': ok(data({ type: 'object' })) } } },
      '/orgs/{orgId}/ai-keys/{provider}': { put: { summary: 'Set the organization\'s own AI key (admin; validated, encrypted)', responses: { '200': ok(data({ type: 'object' })) } }, delete: { summary: 'Remove the key (admin)', responses: { '204': { description: 'Removed' } } } },
      '/orgs/{orgId}/ai-settings': { put: { summary: 'Default AI provider/model (admin)', responses: { '200': ok(data({ type: 'object' })) } } },
      '/orgs/{orgId}/usage': { get: { summary: 'Usage and plan limits', responses: { '200': ok(data({ type: 'object' })) } } },
      '/prompt-guard/policy': {
        get: { summary: 'Prompt Guard policy (scope: read)', tags: ['Prompt Guard'], responses: { '200': ok(data(ref('PromptPolicy'))), ...errorResponses } },
        put: {
          summary: 'Update the Prompt Guard policy (scope: admin). Partial update; changing mode or notice asks members to accept again.',
          tags: ['Prompt Guard'],
          requestBody: { content: { 'application/json': { schema: ref('PromptPolicyUpdate') } } },
          responses: { '200': ok(data(ref('PromptPolicy'))), ...errorResponses }
        }
      },
      '/prompt-guard/events': { get: { summary: 'Flagged-prompt events, metadata only (scope: audit)', tags: ['Prompt Guard'], parameters: [{ name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'before', in: 'query', description: 'Pagination cursor: pass `pagination.nextBefore` from the previous page', schema: { type: 'string', format: 'date-time' } }, { name: 'userId', in: 'query', schema: { type: 'string' } }, { name: 'tool', in: 'query', schema: { type: 'string', enum: ['claude', 'codex', 'cursor', 'copilot', 'antigravity'] } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } }], responses: { '200': ok({ type: 'object', properties: { data: { type: 'array', items: ref('PromptEvent') }, pagination: { type: 'object', properties: { limit: { type: 'integer' }, nextBefore: { type: ['string', 'null'], description: 'Set when more (older) events exist' } } } } }), ...errorResponses } } },
      '/prompt-guard/summary': { get: { summary: 'Totals by rule, tool, category and member consent (scope: audit)', tags: ['Prompt Guard'], parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', maximum: 90 } }], responses: { '200': ok(data({ type: 'object' })), ...errorResponses } } },
      '/prompt-guard/members': { get: { summary: 'Consent and installed hooks per member (scope: audit)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })), ...errorResponses } } },
      '/orgs/{orgId}/prompt-guard/policy': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Policy and the caller\'s consent (session)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'object' })) } }, put: { summary: 'Update the policy (admin session)', tags: ['Prompt Guard'], requestBody: { content: { 'application/json': { schema: ref('PromptPolicyUpdate') } } }, responses: { '200': ok(data(ref('PromptPolicy'))) } } },
      '/orgs/{orgId}/prompt-guard/consent': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], post: { summary: 'Accept or decline the policy: `{ consentVersion, accept }` (session)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'object' })) } } },
      '/orgs/{orgId}/prompt-guard/heartbeat': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], post: { summary: 'Report installed hooks: `{ enabled, tools, policyVersion, clientVersion }` (session)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'object' })) } } },
      '/orgs/{orgId}/prompt-guard/events': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Events (admins: everyone; members: their own)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'array', items: ref('PromptEvent') })) } }, post: { summary: 'Upload events from the extension: `{ events: PromptEvent[] }` (session)', tags: ['Prompt Guard'], responses: { '201': ok(data({ type: 'object' }), 'Stored') } } },
      '/orgs/{orgId}/prompt-guard/members': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Consent and hooks per member (admin session)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'array', items: { type: 'object' } })) } } },
      '/orgs/{orgId}/prompt-guard/summary': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Totals (admin session)', tags: ['Prompt Guard'], responses: { '200': ok(data({ type: 'object' })) } } },
      '/webhook-secret': {
        get: { summary: 'Whether the organization has a webhook signing secret (scope: admin; the secret is never returned here)', tags: ['Webhooks'], responses: { '200': ok(data({ type: 'object', properties: { configured: { type: 'boolean' }, last4: { type: ['string', 'null'] }, createdAt: { type: ['string', 'null'] } } })), ...errorResponses } },
        post: { summary: 'Create or rotate the webhook signing secret (scope: admin). The response is the only time the secret is shown.', tags: ['Webhooks'], responses: { '201': ok(data({ type: 'object', properties: { secret: { type: 'string', description: 'whsec_…' }, last4: { type: 'string' }, createdAt: { type: 'string' } } }), 'Created'), ...errorResponses } },
        delete: { summary: 'Remove the webhook signing secret (scope: admin)', tags: ['Webhooks'], responses: { '204': { description: 'Removed' }, ...errorResponses } }
      },
      '/orgs/{orgId}/webhook-secret': { parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }], get: { summary: 'Signing secret status (admin session)', tags: ['Webhooks'], responses: { '200': ok(data({ type: 'object' })) } }, post: { summary: 'Create or rotate (admin session); shown once', tags: ['Webhooks'], responses: { '201': ok(data({ type: 'object' }), 'Created') } }, delete: { summary: 'Remove (admin session)', tags: ['Webhooks'], responses: { '204': { description: 'Removed' } } } },
      '/keys/{keyId}': { delete: { summary: 'Revoke an API key (scope: admin)', parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Revoked' }, ...errorResponses } } }
    }
  };
}
