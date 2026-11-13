import { z } from 'zod';
import { AI_PROVIDER_IDS, AI_TASKS } from './ai';
import type { AIState } from './ai';
import type { CloudState } from './cloud';
import { AI_TOOLS, BUILTIN_DETECTORS, PROMPT_ACTIONS, PROMPT_MODES, type PromptGuardView } from './promptGuard';
import type { ScanHistoryEntry, ScanMode, ScanResult } from './types';

/** Messages sent from the webview to the extension host. Every message is validated. */
export const webviewMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('scan'), mode: z.enum(['quick', 'full']) }),
  z.object({ type: z.literal('cancelScan') }),
  z.object({ type: z.literal('openDashboard'), tab: z.string().max(40).optional() }),
  z.object({ type: z.literal('openSettings') }),
  z.object({
    type: z.literal('openFile'),
    uri: z.string().min(1).max(4096),
    line: z.number().int().min(1).max(10_000_000).optional(),
    column: z.number().int().min(1).max(100_000).optional(),
    endLine: z.number().int().min(1).max(10_000_000).optional(),
    endColumn: z.number().int().min(1).max(100_000).optional()
  }),
  z.object({
    type: z.literal('aiRun'),
    task: z.enum(AI_TASKS),
    findingId: z.string().max(200).optional(),
    moduleId: z.string().max(200).optional(),
    fileUri: z.string().max(4096).optional()
  }),
  z.object({ type: z.literal('aiCancel') }),
  z.object({ type: z.literal('aiDeleteInsight'), id: z.string().max(200) }),
  z.object({ type: z.literal('setApiKey'), provider: z.enum(AI_PROVIDER_IDS).optional() }),
  z.object({ type: z.literal('removeApiKey'), provider: z.enum(AI_PROVIDER_IDS).optional() }),
  z.object({ type: z.literal('setProvider'), provider: z.enum(AI_PROVIDER_IDS) }),
  z.object({ type: z.literal('testConnection') }),
  z.object({ type: z.literal('listModels') }),
  z.object({ type: z.literal('setModel'), model: z.string().min(1).max(200).regex(/^[\w./:-]+$/) }),
  z.object({ type: z.literal('export'), format: z.enum(['json', 'markdown']) }),
  z.object({ type: z.literal('clearHistory') }),
  z.object({ type: z.literal('createRequirements') }),
  z.object({ type: z.literal('refresh') }),
  // ProjectLens Cloud. Sensitive input (keys, tokens, codes) is collected by VS Code prompts in the host, never in the webview.
  z.object({ type: z.literal('cloudSignIn'), method: z.enum(['github', 'email']) }),
  z.object({ type: z.literal('cloudSignOut') }),
  z.object({ type: z.literal('cloudRefresh') }),
  z.object({ type: z.literal('cloudSelectOrg'), orgId: z.string().uuid() }),
  z.object({ type: z.literal('cloudCreateOrg') }),
  z.object({ type: z.literal('cloudInvite') }),
  z.object({ type: z.literal('cloudChangeRole'), userId: z.string().uuid(), role: z.enum(['owner', 'admin', 'member']) }),
  z.object({ type: z.literal('cloudRemoveMember'), userId: z.string().uuid() }),
  z.object({ type: z.literal('cloudRevokeInvite'), invitationId: z.string().uuid() }),
  z.object({ type: z.literal('cloudCreateKey') }),
  z.object({ type: z.literal('cloudRevokeKey'), keyId: z.string().uuid() }),
  z.object({ type: z.literal('cloudRotateWebhookSecret') }),
  z.object({ type: z.literal('cloudRemoveWebhookSecret') }),
  z.object({ type: z.literal('cloudSetAiKey'), provider: z.enum(AI_PROVIDER_IDS) }),
  z.object({ type: z.literal('cloudRemoveAiKey'), provider: z.enum(AI_PROVIDER_IDS) }),
  z.object({ type: z.literal('cloudSetAiDefault'), provider: z.enum(AI_PROVIDER_IDS) }),
  z.object({ type: z.literal('cloudLink') }),
  z.object({ type: z.literal('cloudUnlink') }),
  z.object({ type: z.literal('cloudSetToken') }),
  z.object({ type: z.literal('cloudScan'), projectId: z.string().uuid().optional() }),
  z.object({ type: z.literal('cloudUpload') }),
  z.object({ type: z.literal('cloudToggleAutoUpload'), enabled: z.boolean() }),
  z.object({ type: z.literal('cloudOpenSettings') }),
  z.object({ type: z.literal('pgRefresh') }),
  z.object({ type: z.literal('pgReview') }),
  z.object({ type: z.literal('pgInstall'), tools: z.array(z.enum(AI_TOOLS)).min(1) }),
  z.object({ type: z.literal('pgUninstall'), tools: z.array(z.enum(AI_TOOLS)).min(1) }),
  z.object({ type: z.literal('pgCopySanitized') }),
  z.object({ type: z.literal('pgSanitizeText') }),
  z.object({
    type: z.literal('pgSavePolicy'),
    patch: z.object({
      mode: z.enum(PROMPT_MODES).optional(),
      notice: z.string().max(2000).optional(),
      builtin: z.partialRecord(z.enum(BUILTIN_DETECTORS.map((d) => d.id) as [string, ...string[]]), z.enum(PROMPT_ACTIONS)).optional(),
      customRules: z
        .array(z.object({ id: z.string().max(40).optional(), name: z.string().max(80), type: z.enum(['term', 'regex']), pattern: z.string().max(300), action: z.enum(['warn', 'redact', 'block']) }))
        .max(100)
        .optional(),
      allowlist: z.array(z.string().max(300)).max(200).optional(),
      webhookUrl: z.string().max(500).nullable().optional()
    })
  })
]);

export type WebviewMessage = z.infer<typeof webviewMessageSchema>;

export function parseWebviewMessage(raw: unknown): WebviewMessage | null {
  const parsed = webviewMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface ScanProgressState {
  mode: ScanMode;
  phase: string;
  processed: number;
  total: number;
  startedAt: string;
}

export interface AppState {
  workspace: { name: string; folders: number; trusted: boolean } | null;
  scan: ScanProgressState | null;
  lastError: string | null;
  result: ScanResult | null;
  history: ScanHistoryEntry[];
  ai: AIState;
  cloud: CloudState;
  promptGuard: PromptGuardView;
  settings: { gitleaksEnabled: boolean; diagnosticsEnabled: boolean };
}

/** Messages sent from the extension host to webviews. */
export type HostMessage =
  | { type: 'state'; state: AppState }
  | { type: 'navigate'; tab: string }
  | { type: 'toast'; level: 'info' | 'error'; message: string };
