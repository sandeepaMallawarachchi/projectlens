import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { newApiKey } from '@/lib/crypto';
import { createKeySchema } from '@/lib/validation';
import type { ApiKeyRecord } from '@/lib/store';

export const dynamic = 'force-dynamic';

const keyDto = (k: ApiKeyRecord) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt });

export const GET = handle(async (req: Request) => {
  await authenticate(req, 'admin');
  return json({ data: (await getStore().listApiKeys()).map(keyDto) });
});

/** Creates an API key. The plaintext key is returned once and stored only as a SHA-256 hash. */
export const POST = handle(async (req: Request) => {
  await authenticate(req, 'admin');
  const body = await readJson(req, createKeySchema);
  const generated = newApiKey();
  const record = await getStore().createApiKey({ name: body.name, prefix: generated.prefix, keyHash: generated.hash, scopes: body.scopes });
  return json({ data: { ...keyDto(record), key: generated.key } }, 201);
});
