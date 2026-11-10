import type * as vscode from 'vscode';
import { AI_PROVIDER_IDS, type AIProviderId } from '../models/ai';

/** SecretStorage key per provider. `projectlens.groq.apiKey` is unchanged from earlier versions. */
export const secretKeyFor = (id: AIProviderId) => `projectlens.${id}.apiKey`;

/** AI provider credentials live exclusively in VS Code SecretStorage (OS keychain backed). */
export class ApiKeyStore {
  private readonly cache = new Map<AIProviderId, string | undefined>();

  constructor(private readonly secrets: vscode.SecretStorage) {
    secrets.onDidChange((e) => {
      for (const id of AI_PROVIDER_IDS) {
        if (e.key === secretKeyFor(id)) {
          this.cache.delete(id);
        }
      }
    });
  }

  async get(id: AIProviderId): Promise<string | undefined> {
    if (!this.cache.has(id)) {
      this.cache.set(id, await this.secrets.get(secretKeyFor(id)));
    }
    return this.cache.get(id) || undefined;
  }

  async has(id: AIProviderId): Promise<boolean> {
    return !!(await this.get(id));
  }

  async set(id: AIProviderId, value: string): Promise<void> {
    await this.secrets.store(secretKeyFor(id), value.trim());
    this.cache.set(id, value.trim());
  }

  async remove(id: AIProviderId): Promise<void> {
    await this.secrets.delete(secretKeyFor(id));
    this.cache.set(id, undefined);
  }
}
