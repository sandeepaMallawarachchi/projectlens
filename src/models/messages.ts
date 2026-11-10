import { z } from 'zod';
import { AI_PROVIDER_IDS, AI_TASKS } from './ai';
import type { AIState } from './ai';
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
  z.object({ type: z.literal('refresh') })
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
  settings: { gitleaksEnabled: boolean; diagnosticsEnabled: boolean };
}

/** Messages sent from the extension host to webviews. */
export type HostMessage =
  | { type: 'state'; state: AppState }
  | { type: 'navigate'; tab: string }
  | { type: 'toast'; level: 'info' | 'error'; message: string };
