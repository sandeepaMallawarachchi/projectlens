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
      version: '0.1.0',
      description:
        'Remote analysis of GitHub/GitLab repositories: technologies, code quality, security, implementation progress, production readiness and optional AI insights. Authenticate with `Authorization: Bearer <api key>`. Scopes: read, scan, ai, admin.'
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API key (plk_…) or the admin key' } },
      schemas: {
        ErrorResponse: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
        CreateProject: {
          type: 'object',
          required: ['name', 'provider', 'repository'],
          properties: {
            name: { type: 'string' },
            provider: { type: 'string', enum: ['github', 'gitlab'] },
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
                schema: { type: 'object', properties: { mode: { type: 'string', enum: ['quick', 'full'], default: 'full' }, ref: { type: 'string' }, force: { type: 'boolean' }, wait: { type: 'boolean' }, callbackUrl: { type: 'string', description: 'HTTPS webhook receiving scan.completed / scan.failed' } } }
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
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: ['read', 'scan', 'ai', 'admin'] } } } } } } },
          responses: { '201': ok(data({ type: 'object' }), 'Created'), ...errorResponses }
        }
      },
      '/keys/{keyId}': { delete: { summary: 'Revoke an API key (scope: admin)', parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Revoked' }, ...errorResponses } } }
    }
  };
}
