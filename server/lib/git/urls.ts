import { HttpError } from '../http';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|.*\.internal$|.*\.local$)/i;

/**
 * Validates outbound URLs supplied by API clients (self-hosted GitLab, webhooks) to reduce SSRF risk:
 * HTTPS only, no private/loopback literals, and an optional allow-list.
 */
export function assertSafeOutboundUrl(raw: string, allowListEnv?: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'invalid_url', `Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_url', 'Only https:// URLs are allowed');
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new HttpError(400, 'invalid_url', 'Private or loopback hosts are not allowed');
  }
  const allow = allowListEnv ? process.env[allowListEnv] : undefined;
  if (allow) {
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    if (!hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
      throw new HttpError(400, 'invalid_url', `Host ${url.hostname} is not in ${allowListEnv}`);
    }
  }
  return url;
}

/** Accepts `owner/repo`, `group/sub/project`, or full https URLs (with optional .git / tree suffixes). */
export function parseRepository(provider: 'github' | 'gitlab', input: string, baseUrl?: string | null): { repository: string; baseUrl: string | null } {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (/^https?:\/\//.test(trimmed)) {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/^\/+/, '').split('/-/')[0].replace(/\/(tree|blob)\/.*$/, '');
    const defaultHost = provider === 'github' ? 'github.com' : 'gitlab.com';
    const origin = url.hostname === defaultHost ? null : `${url.protocol}//${url.host}`;
    return { repository: path, baseUrl: baseUrl ?? origin };
  }
  return { repository: trimmed.replace(/^\/+/, ''), baseUrl: baseUrl ?? null };
}
