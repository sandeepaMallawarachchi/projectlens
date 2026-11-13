/**
 * Latest published version of the extension on each store, shown on the landing page.
 * Cached in memory for an hour per server instance; any failure simply hides the badge.
 */

export const EXTENSION_ID = 'SandeepaMallawarachchi.projectlens';
export const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}`;
export const OPEN_VSX_URL = 'https://open-vsx.org/extension/SandeepaMallawarachchi/projectlens';

const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; value: StoreVersions } | null = null;

export interface StoreVersions {
  marketplace: string | null;
  openVsx: string | null;
}

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;
const clean = (v: unknown): string | null => (typeof v === 'string' && VERSION.test(v) ? v : null);

async function openVsxVersion(): Promise<string | null> {
  const res = await fetch('https://open-vsx.org/api/SandeepaMallawarachchi/projectlens', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  return clean(((await res.json()) as { version?: unknown }).version);
}

async function marketplaceVersion(): Promise<string | null> {
  const res = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
    // filterType 7 = extension name; flag 0x1 = include versions (newest first).
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }], flags: 0x1 }),
    signal: AbortSignal.timeout(3000),
    cache: 'no-store'
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { results?: { extensions?: { versions?: { version?: unknown }[] }[] }[] };
  return clean(data.results?.[0]?.extensions?.[0]?.versions?.[0]?.version);
}

export async function storeVersions(): Promise<StoreVersions> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  const [marketplace, openVsx] = await Promise.all([marketplaceVersion().catch(() => null), openVsxVersion().catch(() => null)]);
  const value = { marketplace, openVsx };
  // Only cache successful lookups for the full hour; retry failures after a minute.
  cache = { at: marketplace && openVsx ? Date.now() : Date.now() - TTL_MS + 60_000, value };
  return value;
}
