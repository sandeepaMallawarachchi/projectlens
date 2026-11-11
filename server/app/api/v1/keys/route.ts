import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore, type ApiKeyRecord } from '@/lib/store';
import { newApiKey } from '@/lib/crypto';
import { createKeySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const keyDto = (k: ApiKeyRecord) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt });

/** API keys of the caller's organization (organization admins). */
export const GET = handle(async (req: Request) => {
  const principal = await authenticate(req, 'admin');
  return json({ data: (await getStore().listApiKeys(principal.orgId)).map(keyDto) });
});

/** Creates an organization API key. The plaintext key is returned once and stored only as a SHA-256 hash. */
export const POST = handle(async (req: Request) => {
  const principal = await authenticate(req, 'admin');
  const body = await readJson(req, createKeySchema);
  const generated = newApiKey();
  const record = await getStore().createApiKey({ orgId: principal.orgId, name: body.name, prefix: generated.prefix, keyHash: generated.hash, scopes: body.scopes, createdBy: principal.userId });
  return json({ data: { ...keyDto(record), key: generated.key } }, 201);
});
