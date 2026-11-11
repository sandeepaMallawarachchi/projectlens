import { HttpError } from './http';
import { getStore } from './store';

/** Free-plan limits (environment-configurable). Paid plans can raise these later. */
export function limits() {
  const n = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    projects: n('FREE_MAX_PROJECTS', 25),
    cloudScansPerDay: n('FREE_MAX_SCANS_PER_DAY', 100),
    uploadsPerDay: n('FREE_MAX_UPLOADS_PER_DAY', 200),
    aiInsightsPerDay: n('FREE_MAX_AI_PER_DAY', 50)
  };
}

const dayAgo = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export async function assertQuota(orgId: string, kind: 'project' | 'cloudScan' | 'upload' | 'ai'): Promise<void> {
  const store = getStore();
  const l = limits();
  const [used, max, label] =
    kind === 'project'
      ? [await store.countProjects(orgId), l.projects, 'projects']
      : kind === 'cloudScan'
        ? [await store.countScansSince(orgId, dayAgo(), 'cloud'), l.cloudScansPerDay, 'cloud scans per 24 h']
        : kind === 'upload'
          ? [await store.countScansSince(orgId, dayAgo(), 'upload'), l.uploadsPerDay, 'uploads per 24 h']
          : [await store.countInsightsSince(orgId, dayAgo()), l.aiInsightsPerDay, 'AI insights per 24 h'];
  if (used >= max) {
    throw new HttpError(429, 'quota_exceeded', `Plan limit reached: ${max} ${label}.`, { used, limit: max });
  }
}

export async function usage(orgId: string) {
  const store = getStore();
  const [projects, scansToday, uploadsToday, aiToday, scansMonth, uploadsMonth, aiMonth] = await Promise.all([
    store.countProjects(orgId),
    store.countScansSince(orgId, dayAgo(), 'cloud'),
    store.countScansSince(orgId, dayAgo(), 'upload'),
    store.countInsightsSince(orgId, dayAgo()),
    store.countScansSince(orgId, monthStart(), 'cloud'),
    store.countScansSince(orgId, monthStart(), 'upload'),
    store.countInsightsSince(orgId, monthStart())
  ]);
  return {
    limits: limits(),
    last24h: { cloudScans: scansToday, uploads: uploadsToday, aiInsights: aiToday },
    thisMonth: { cloudScans: scansMonth, uploads: uploadsMonth, aiInsights: aiMonth },
    projects
  };
}
