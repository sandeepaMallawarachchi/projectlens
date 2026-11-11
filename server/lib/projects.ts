import type { z } from 'zod';
import { encryptSecret } from './crypto';
import { HttpError, notFound } from './http';
import { assertSafeOutboundUrl, parseRepository } from './git/urls';
import { assertQuota } from './quotas';
import { getStore, type ProjectRecord } from './store';
import type { Principal } from './auth';
import type { createProjectSchema, updateProjectSchema } from './validation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves `/projects/{id}` within the caller's organization: UUID or `ext:<externalId>`. */
export async function resolveProject(orgId: string, param: string): Promise<ProjectRecord> {
  const store = getStore();
  const decoded = decodeURIComponent(param);
  const project = decoded.startsWith('ext:')
    ? await store.findProjectByExternalId(orgId, decoded.slice(4))
    : UUID.test(decoded)
      ? await store.getProject(orgId, decoded)
      : null;
  if (!project) {
    throw notFound('Project');
  }
  return project;
}

export async function createProject(principal: Principal, input: z.infer<typeof createProjectSchema>): Promise<ProjectRecord> {
  const store = getStore();
  await assertQuota(principal.orgId, 'project');
  let repository = input.repository ?? '';
  let baseUrl: string | null = input.baseUrl ?? null;
  if (input.provider === 'github' || input.provider === 'gitlab') {
    ({ repository, baseUrl } = parseRepository(input.provider, repository, input.baseUrl));
    if (!repository || repository.split('/').length < 2) {
      throw new HttpError(400, 'invalid_request', 'repository must look like "owner/repo" (GitHub) or "group/project" (GitLab), or be a repository URL');
    }
    if (baseUrl) {
      baseUrl = assertSafeOutboundUrl(baseUrl, input.provider === 'gitlab' ? 'GITLAB_ALLOWED_HOSTS' : 'GITHUB_ALLOWED_HOSTS').origin;
    }
  } else if (input.provider === 'local' && !repository) {
    throw new HttpError(400, 'invalid_request', 'repository (a directory path) is required for local projects');
  } else if (input.provider === 'none') {
    repository = '';
  }
  if (input.externalId && (await store.findProjectByExternalId(principal.orgId, input.externalId))) {
    throw new HttpError(409, 'conflict', `A project with externalId "${input.externalId}" already exists`);
  }
  return store.createProject({
    orgId: principal.orgId,
    name: input.name,
    provider: input.provider,
    repository,
    baseUrl,
    ref: input.ref ?? null,
    tokenEncrypted: input.accessToken ? encryptSecret(input.accessToken) : null,
    externalId: input.externalId ?? null,
    metadata: input.metadata ?? {},
    createdBy: principal.userId
  });
}

export async function updateProject(project: ProjectRecord, input: z.infer<typeof updateProjectSchema>): Promise<ProjectRecord> {
  const store = getStore();
  if (input.externalId && input.externalId !== project.externalId && (await store.findProjectByExternalId(project.orgId, input.externalId))) {
    throw new HttpError(409, 'conflict', `A project with externalId "${input.externalId}" already exists`);
  }
  const patch: Partial<ProjectRecord> = {};
  if (input.name !== undefined) {
    patch.name = input.name;
  }
  if (input.ref !== undefined) {
    patch.ref = input.ref;
  }
  if (input.externalId !== undefined) {
    patch.externalId = input.externalId;
  }
  if (input.metadata !== undefined) {
    patch.metadata = input.metadata;
  }
  if (input.accessToken !== undefined) {
    patch.tokenEncrypted = input.accessToken ? encryptSecret(input.accessToken) : null;
  }
  return store.updateProject(project.orgId, project.id, patch);
}
