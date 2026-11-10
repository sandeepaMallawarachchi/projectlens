import type { Severity } from '../../src/models/types';

export function relativeTime(iso: string | undefined): string {
  if (!iso) {
    return 'never';
  }
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min} min ago`;
  }
  const h = Math.round(min / 60);
  if (h < 24) {
    return `${h} h ago`;
  }
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function scoreTone(score: number | null): 'good' | 'fair' | 'poor' | 'none' {
  if (score === null) {
    return 'none';
  }
  return score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
