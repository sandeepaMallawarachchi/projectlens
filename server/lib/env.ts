import { AI_PROVIDERS, isProviderId, type AIProviderId } from '@/engine/models/ai';

/** Server configuration from environment variables (see .env.example). */
export function env() {
  const provider = process.env.AI_PROVIDER ?? 'groq';
  const aiProvider: AIProviderId = isProviderId(provider) ? provider : 'groq';
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    storage: (process.env.STORAGE ?? (process.env.SUPABASE_URL ? 'supabase' : 'memory')) as 'supabase' | 'memory',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    adminKey: process.env.PROJECTLENS_ADMIN_KEY ?? '',
    encryptionKey: process.env.PROJECTLENS_ENCRYPTION_KEY ?? '',
    webhookSecret: process.env.PROJECTLENS_WEBHOOK_SECRET ?? '',
    maxRepoBytes: num('MAX_REPO_MB', 200) * 1024 * 1024,
    maxFileBytes: num('MAX_FILE_KB', 512) * 1024,
    maxFiles: num('MAX_FILES', 8000),
    scanMinIntervalMs: num('SCAN_MIN_INTERVAL_SECONDS', 60) * 1000,
    scanHistoryLimit: num('SCAN_HISTORY_LIMIT', 30),
    ai: {
      provider: aiProvider,
      model: process.env.AI_MODEL || AI_PROVIDERS[aiProvider].defaultModel,
      keys: {
        groq: process.env.GROQ_API_KEY,
        openai: process.env.OPENAI_API_KEY,
        gemini: process.env.GEMINI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY
      } as Record<AIProviderId, string | undefined>,
      maxContextTokens: num('AI_MAX_CONTEXT_TOKENS', 8000),
      maxOutputTokens: num('AI_MAX_OUTPUT_TOKENS', 4000),
      timeoutMs: num('AI_TIMEOUT_SECONDS', 120) * 1000,
      maxRetries: num('AI_MAX_RETRIES', 3)
    },
    /** Lets tests and local development scan a directory instead of a remote repository. */
    allowLocalRepos: process.env.ALLOW_LOCAL_REPOS === 'true'
  };
}
