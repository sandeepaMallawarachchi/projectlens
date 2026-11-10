import { z } from 'zod';

export const AI_PROVIDER_IDS = ['groq', 'openai', 'gemini', 'anthropic'] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  defaultModel: string;
  /** Typical key prefix, used only for a soft validation warning. */
  keyPrefix: string;
  keyUrl: string;
}

export const AI_PROVIDERS: Record<AIProviderId, AIProviderInfo> = {
  groq: { id: 'groq', label: 'Groq', defaultModel: 'openai/gpt-oss-20b', keyPrefix: 'gsk_', keyUrl: 'https://console.groq.com/keys' },
  openai: { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5-mini', keyPrefix: 'sk-', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyPrefix: 'AI', keyUrl: 'https://aistudio.google.com/apikey' },
  anthropic: { id: 'anthropic', label: 'Anthropic Claude', defaultModel: 'claude-opus-5-5', keyPrefix: 'sk-ant-', keyUrl: 'https://console.anthropic.com/settings/keys' }
};

export function isProviderId(value: unknown): value is AIProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export const AI_TASKS = [
  'explainFinding',
  'reviewFile',
  'reviewModule',
  'architectureSummary',
  'incompletePatterns',
  'improvements',
  'securityConcerns',
  'projectAssessment'
] as const;
export type AITask = (typeof AI_TASKS)[number];

export const AI_TASK_LABELS: Record<AITask, string> = {
  explainFinding: 'Explain finding',
  reviewFile: 'File review',
  reviewModule: 'Module review',
  architectureSummary: 'Architecture summary',
  incompletePatterns: 'Incomplete implementation patterns',
  improvements: 'Prioritized improvements',
  securityConcerns: 'Security concerns',
  projectAssessment: 'Project assessment (Deep Review)'
};

const severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
const confidence = z.enum(['high', 'medium', 'low']);

export const fileReferenceSchema = z.object({
  path: z.string().min(1).max(500),
  line: z.number().int().min(0).max(10_000_000).catch(0)
});

export const aiObservationSchema = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(4000),
  category: z.string().max(60).catch('general'),
  severity: severity.catch('info'),
  confidence: confidence.catch('low'),
  fileReferences: z.array(fileReferenceSchema).max(20).catch([])
});

export const aiRecommendationSchema = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(4000),
  priority: z.enum(['high', 'medium', 'low']).catch('medium'),
  effort: z.enum(['small', 'medium', 'large']).catch('medium'),
  severity: severity.catch('info'),
  confidence: confidence.catch('low'),
  fileReferences: z.array(fileReferenceSchema).max(20).catch([])
});

/** Validated shape of every AI response. AI output is treated as untrusted data. */
export const aiAnalysisSchema = z.object({
  summary: z.string().min(1).max(8000),
  observations: z.array(aiObservationSchema).max(40),
  recommendations: z.array(aiRecommendationSchema).max(40),
  overallSeverity: severity.catch('info'),
  overallConfidence: confidence.catch('low')
});

export type AIAnalysis = z.infer<typeof aiAnalysisSchema>;
export type AIFileReference = z.infer<typeof fileReferenceSchema> & { uri?: string; verified?: boolean };

/** JSON Schema sent to providers that support structured outputs. Mirrors `aiAnalysisSchema`. */
export const AI_ANALYSIS_JSON_SCHEMA = (() => {
  const sev = { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] };
  const conf = { type: 'string', enum: ['high', 'medium', 'low'] };
  const refs = {
    type: 'array',
    items: {
      type: 'object',
      properties: { path: { type: 'string' }, line: { type: 'integer' } },
      required: ['path', 'line'],
      additionalProperties: false
    }
  };
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      observations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            category: { type: 'string' },
            severity: sev,
            confidence: conf,
            fileReferences: refs
          },
          required: ['title', 'detail', 'category', 'severity', 'confidence', 'fileReferences'],
          additionalProperties: false
        }
      },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            effort: { type: 'string', enum: ['small', 'medium', 'large'] },
            severity: sev,
            confidence: conf,
            fileReferences: refs
          },
          required: ['title', 'detail', 'priority', 'effort', 'severity', 'confidence', 'fileReferences'],
          additionalProperties: false
        }
      },
      overallSeverity: sev,
      overallConfidence: conf
    },
    required: ['summary', 'observations', 'recommendations', 'overallSeverity', 'overallConfidence'],
    additionalProperties: false
  } as const;
})();

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIInsight {
  id: string;
  task: AITask;
  title: string;
  target?: string;
  createdAt: string;
  /** Older insights (before multi-provider support) have no provider and came from Groq. */
  provider?: AIProviderId;
  model: string;
  outputMode: 'json_schema' | 'json_object' | 'prompt';
  analysis: AIAnalysis;
  /** Files whose (redacted) content was sent. */
  contextFiles: string[];
  usage?: AIUsage;
  requests: number;
  /** Verified file references (display path → file URI) for navigation. */
  fileUris: Record<string, string>;
}

export interface AIState {
  /** Active provider used for AI requests. */
  provider: AIProviderId;
  /** Key status for every provider (the key itself never reaches the webview). */
  providers: { id: AIProviderId; label: string; hasApiKey: boolean; model: string }[];
  /** Whether the active provider has a key. */
  hasApiKey: boolean;
  model: string;
  availableModels: string[];
  running: { task: AITask; title: string; startedAt: string } | null;
  lastError: string | null;
  connection: { status: 'unknown' | 'ok' | 'error'; message: string; checkedAt?: string };
  insights: AIInsight[];
  sessionUsage: AIUsage & { requests: number };
  rateLimit?: { remainingRequests?: string; remainingTokens?: string };
}
