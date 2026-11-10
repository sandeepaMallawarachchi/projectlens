import type * as vscode from 'vscode';

const GROQ_KEY = 'projectlens.groq.apiKey';

/** Groq credentials live exclusively in VS Code SecretStorage (OS keychain backed). */
export class GroqKeyStore {
  private cached: string | undefined | null = null;

  constructor(private readonly secrets: vscode.SecretStorage) {
    secrets.onDidChange((e) => {
      if (e.key === GROQ_KEY) {
        this.cached = null;
      }
    });
  }

  async get(): Promise<string | undefined> {
    if (this.cached === null) {
      this.cached = await this.secrets.get(GROQ_KEY);
    }
    return this.cached ?? undefined;
  }

  async has(): Promise<boolean> {
    return !!(await this.get());
  }

  async set(value: string): Promise<void> {
    await this.secrets.store(GROQ_KEY, value.trim());
    this.cached = value.trim();
  }

  async remove(): Promise<void> {
    await this.secrets.delete(GROQ_KEY);
    this.cached = undefined;
  }
}
