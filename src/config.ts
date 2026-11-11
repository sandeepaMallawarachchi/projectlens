import * as vscode from 'vscode';
import type { Severity } from './models/types';
import { AI_PROVIDERS, isProviderId, type AIProviderId } from './models/ai';

/** Setting key holding the model for a provider, e.g. `ai.anthropic.model`. */
export const modelSettingKey = (id: AIProviderId) => `ai.${id}.model`;

export function modelFor(id: AIProviderId): string {
  const c = vscode.workspace.getConfiguration('projectlens');
  const configured = c.get<string>(modelSettingKey(id), '');
  // `ai.model` was the Groq model setting before multi-provider support.
  const legacy = id === 'groq' ? c.get<string>('ai.model', '') : '';
  return configured || legacy || AI_PROVIDERS[id].defaultModel;
}

export function getConfig() {
  const c = vscode.workspace.getConfiguration('projectlens');
  const providerSetting = c.get<string>('ai.provider', 'groq');
  const provider: AIProviderId = isProviderId(providerSetting) ? providerSetting : 'groq';
  return {
    ai: {
      provider,
      model: modelFor(provider),
      maxContextTokens: c.get<number>('ai.maxContextTokens', 6000),
      maxOutputTokens: c.get<number>('ai.maxOutputTokens', 2500),
      requestTimeoutMs: c.get<number>('ai.requestTimeoutSeconds', 60) * 1000,
      maxRetries: c.get<number>('ai.maxRetries', 3),
      maxConcurrentRequests: c.get<number>('ai.maxConcurrentRequests', 2),
      maxRequestsPerSession: c.get<number>('ai.maxRequestsPerSession', 40)
    },
    scan: {
      maxFileSizeBytes: c.get<number>('scan.maxFileSizeKb', 10240) * 1024,
      maxFiles: c.get<number>('scan.maxFiles', 8000),
      respectGitignore: c.get<boolean>('scan.respectGitignore', true),
      exclude: c.get<string[]>('scan.exclude', [])
    },
    gitleaks: {
      enabled: c.get<boolean>('gitleaks.enabled', false),
      path: c.get<string>('gitleaks.path', '')
    },
    diagnostics: {
      enabled: c.get<boolean>('diagnostics.enabled', true),
      minimumSeverity: c.get<Severity>('diagnostics.minimumSeverity', 'medium')
    },
    historyMax: c.get<number>('history.maxEntries', 20)
  };
}
