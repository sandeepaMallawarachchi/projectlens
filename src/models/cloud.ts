/** ProjectLens Cloud state shown in the dashboard. Contains no tokens or keys. */

export type CloudRole = 'owner' | 'admin' | 'member';

export interface CloudScoresView {
  quality: number | null;
  security: number | null;
  implementation: number | null;
  readiness: number | null;
}

export interface CloudProjectView {
  id: string;
  name: string;
  provider: 'github' | 'gitlab' | 'none' | 'local';
  repository: string;
  externalId: string | null;
  hasAccessToken: boolean;
  latestScan: { id: string; status: string; source: 'cloud' | 'upload'; finishedAt: string | null; commitSha: string | null; scores: CloudScoresView | null; critical: number; high: number } | null;
}

export interface CloudState {
  apiUrl: string;
  signedIn: boolean;
  methods: { github: boolean; email: boolean } | null;
  user: { name: string | null; email: string | null; githubLogin: string | null } | null;
  organizations: { id: string; name: string; role: CloudRole; plan: string }[];
  currentOrgId: string | null;
  members: { userId: string; name: string | null; email: string | null; githubLogin: string | null; role: CloudRole; joinedAt: string }[];
  invitations: { id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null }[];
  apiKeys: { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
  aiKeys: { provider: string; label: string; configured: boolean; last4: string | null; defaultModel: string }[];
  aiDefaultProvider: string | null;
  projects: CloudProjectView[];
  linkedProjectId: string | null;
  usage: {
    limits: { projects: number; cloudScansPerDay: number; uploadsPerDay: number; aiInsightsPerDay: number };
    last24h: { cloudScans: number; uploads: number; aiInsights: number };
    projects: number;
  } | null;
  busy: string | null;
  error: string | null;
  lastSync: string | null;
  autoUpload: boolean;
}

export const EMPTY_CLOUD_STATE = (apiUrl: string): CloudState => ({
  apiUrl,
  signedIn: false,
  methods: null,
  user: null,
  organizations: [],
  currentOrgId: null,
  members: [],
  invitations: [],
  apiKeys: [],
  aiKeys: [],
  aiDefaultProvider: null,
  projects: [],
  linkedProjectId: null,
  usage: null,
  busy: null,
  error: null,
  lastSync: null,
  autoUpload: false
});
