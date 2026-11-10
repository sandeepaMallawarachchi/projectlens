import { z } from 'zod';

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

/** JSON Schema sent to Groq when structured outputs are supported. Mirrors `aiAnalysisSchema`. */
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
