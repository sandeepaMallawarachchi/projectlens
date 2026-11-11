import type { z } from 'zod';
import { encryptSecret } from './crypto';
import { HttpError, notFound } from './http';
import { assertSafeOutboundUrl, parseRepository } from './git/urls';
import { getStore, type ProjectRecord } from './store';
import type { createProjectSchema, updateProjectSchema } from './validation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves `/projects/{id}` where id is the ProjectLens UUID or `ext:<externalId>`. */
export async function resolveProject(param: string): Promise<ProjectRecord> {
  const store = getStore();
  const decoded = decodeURIComponent(param);
  const project = decoded.startsWith('ext:') ? await store.findProjectByExternalId(decoded.slice(4)) : UUID.test(decoded) ? await store.getProject(decoded) : null;
  if (!project) {
    throw notFound('Project');
  }
  return project;
}

export async function createProject(input: z.infer<typeof createProjectSchema>): Promise<ProjectRecord> {
  const store = getStore();
  let repository = input.repository;
  let baseUrl: string | null = input.baseUrl ?? null;
  if (input.provider !== 'local') {
    ({ repository, baseUrl } = parseRepository(input.provider, input.repository, input.baseUrl));
    if (!repository || repository.split('/').length < 2) {
      throw new HttpError(400, 'invalid_request', 'repository must look like "owner/repo" (GitHub) or "group/project" (GitLab), or be a repository URL');
    }
    if (baseUrl) {
      baseUrl = assertSafeOutboundUrl(baseUrl, input.provider === 'gitlab' ? 'GITLAB_ALLOWED_HOSTS' : 'GITHUB_ALLOWED_HOSTS').origin;
    }
  }
  if (input.externalId && (await store.findProjectByExternalId(input.externalId))) {
    throw new HttpError(409, 'conflict', `A project with externalId "${input.externalId}" already exists`);
  }
  return store.createProject({
    name: input.name,
    provider: input.provider,
    repository,
    baseUrl,
    ref: input.ref ?? null,
    tokenEncrypted: input.accessToken ? encryptSecret(input.accessToken) : null,
    externalId: input.externalId ?? null,
    metadata: input.metadata ?? {}
  });
}

export async function updateProject(project: ProjectRecord, input: z.infer<typeof updateProjectSchema>): Promise<ProjectRecord> {
  const store = getStore();
  if (input.externalId && input.externalId !== project.externalId && (await store.findProjectByExternalId(input.externalId))) {
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
  return store.updateProject(project.id, patch);
}
