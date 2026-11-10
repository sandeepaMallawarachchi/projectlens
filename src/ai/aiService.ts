import type { ScanResult } from '../models/types';
import { AI_ANALYSIS_JSON_SCHEMA, AI_TASK_LABELS, type AIInsight, type AIUsage, type AIAnalysis } from '../models/ai';
import type { AIProvider } from './AIProvider';
import { buildContext, renderUserPrompt, type BuiltContext, type ContextRequest, type FileReader } from './contextBuilder';
import { SYSTEM_PROMPT, TASK_INSTRUCTIONS } from './prompts';
import { parseAnalysis } from './responseParser';
import { AIError } from './errors';
import { ConcurrencyLimiter } from '../utils/async';
import { shortHash } from '../utils/hash';

export interface AISettings {
  model: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  maxRequestsPerSession: number;
  maxConcurrentRequests: number;
}

export interface ConsentPreview {
  title: string;
  model: string;
  provider: string;
  files: { path: string; lines: string; redactions: number; truncated: boolean }[];
  excluded: { path: string; reason: string }[];
  estimatedTokens: number;
  redactions: number;
  requests: number;
  /** Exact payload(s) that will be sent. */
  payload: string;
}

export interface AIServiceDeps {
  /** Active provider, resolved per request so provider/model switches apply immediately. */
  provider: () => AIProvider;
  settings: () => AISettings;
  readFile: FileReader;
  /** Must return true only after explicit user approval. */
  consent: (preview: ConsentPreview) => Promise<boolean>;
  onUsage?: (usage: AIUsage, rateLimit?: { remainingRequests?: string; remainingTokens?: string }) => void;
}

const MAX_BATCHES = 3;

export class AIService {
  private requestsThisSession = 0;
  private limiter: ConcurrencyLimiter;
  private limiterSize: number;

  constructor(private readonly deps: AIServiceDeps) {
    this.limiterSize = deps.settings().maxConcurrentRequests;
    this.limiter = new ConcurrencyLimiter(this.limiterSize);
  }

  get sessionRequests(): number {
    return this.requestsThisSession;
  }

  private getLimiter(): ConcurrencyLimiter {
    const size = this.deps.settings().maxConcurrentRequests;
    if (size !== this.limiterSize && this.limiter.pending === 0) {
      this.limiter = new ConcurrencyLimiter(size);
      this.limiterSize = size;
    }
    return this.limiter;
  }

  /** Builds one or more contexts (module reviews are split into batches when they exceed the budget). */
  async prepare(req: ContextRequest): Promise<BuiltContext[]> {
    const budget = this.deps.settings().maxContextTokens;
    const first = await buildContext(req, this.deps.readFile, budget);
    if (req.task !== 'reviewModule' || !first.excluded.some((e) => e.reason === 'token budget exhausted')) {
      return [first];
    }
    // Batch remaining module files into additional requests (bounded).
    const batches = [first];
    const mod = req.scan.progress.modules.find((m) => m.id === req.moduleId);
    const remaining = first.excluded.filter((e) => e.reason === 'token budget exhausted').map((e) => e.path);
    while (remaining.length && batches.length < MAX_BATCHES && mod) {
      const chunk = remaining.splice(0, 6);
      const subModule = { ...mod, evidence: mod.evidence.filter((e) => chunk.includes(e.file)) };
      const subScan: ScanResult = { ...req.scan, progress: { ...req.scan.progress, modules: req.scan.progress.modules.map((m) => (m.id === mod.id ? subModule : m)) } };
      const ctx = await buildContext({ ...req, scan: subScan }, this.deps.readFile, budget);
      ctx.title = `${first.title} (part ${batches.length + 1})`;
      batches.push(ctx);
    }
    return batches;
  }

  async run(req: ContextRequest, signal?: AbortSignal): Promise<AIInsight> {
    const settings = this.deps.settings();
    const provider = this.deps.provider();
    const contexts = await this.prepare(req);
    if (this.requestsThisSession + contexts.length > settings.maxRequestsPerSession) {
      throw new AIError('limit', `Session limit of ${settings.maxRequestsPerSession} AI requests reached (projectlens.ai.maxRequestsPerSession). Reload the window or raise the limit.`);
    }
    const instructions = TASK_INSTRUCTIONS[req.task];
    const prompts = contexts.map((c) => renderUserPrompt(c, instructions));
    const preview: ConsentPreview = {
      title: contexts[0].title || AI_TASK_LABELS[req.task],
      model: settings.model,
      provider: provider.displayName,
      files: contexts.flatMap((c) => c.files.map((f) => ({ path: f.path, lines: `${f.startLine}-${f.endLine}`, redactions: f.redactions, truncated: f.truncated }))),
      excluded: contexts.flatMap((c) => c.excluded),
      estimatedTokens: contexts.reduce((s, c) => s + c.estimatedTokens, 0),
      redactions: contexts.reduce((s, c) => s + c.redactions, 0),
      requests: contexts.length,
      payload: prompts.map((p, i) => `--- SYSTEM ---\n${SYSTEM_PROMPT}\n\n--- USER (request ${i + 1}/${prompts.length}) ---\n${p}`).join('\n\n')
    };
    if (!(await this.deps.consent(preview))) {
      throw new AIError('consent-declined', 'User declined to send context.');
    }
    if (signal?.aborted) {
      throw new AIError('cancelled', 'Request cancelled');
    }

    const usage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let outputMode: AIInsight['outputMode'] = 'json_schema';
    let model = settings.model;
    // Batches run sequentially through the shared limiter to stay rate-limit friendly.
    const analyses: AIAnalysis[] = [];
    for (let i = 0; i < contexts.length; i++) {
      this.requestsThisSession++;
      const res = await this.getLimiter().run(() =>
        provider.complete({
          model: settings.model,
          system: SYSTEM_PROMPT,
          user: prompts[i],
          maxOutputTokens: settings.maxOutputTokens,
          jsonSchema: { name: 'projectlens_analysis', schema: AI_ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown> },
          signal
        })
      );
      outputMode = res.mode;
      model = res.model;
      if (res.usage) {
        usage.promptTokens += res.usage.promptTokens;
        usage.completionTokens += res.usage.completionTokens;
        usage.totalTokens += res.usage.totalTokens;
        this.deps.onUsage?.(res.usage, res.rateLimit);
      }
      analyses.push(parseAnalysis(res.text, contexts[i].allowedPaths).analysis);
    }

    const analysis = mergeAnalyses(analyses);
    const uriByPath = new Map<string, string>();
    for (const c of contexts) {
      for (const [p, u] of c.uriByPath) {
        uriByPath.set(p, u);
      }
    }
    const referenced = new Set([...analysis.observations, ...analysis.recommendations].flatMap((x) => x.fileReferences.map((r) => r.path)));
    return {
      id: shortHash(`${req.task}|${Date.now()}|${Math.random()}`, 12),
      task: req.task,
      title: contexts[0].title || AI_TASK_LABELS[req.task],
      target: contexts[0].target,
      createdAt: new Date().toISOString(),
      provider: provider.id,
      model,
      outputMode,
      analysis,
      contextFiles: [...new Set(contexts.flatMap((c) => c.files.map((f) => f.path)))],
      usage,
      requests: contexts.length,
      fileUris: Object.fromEntries([...referenced].filter((p) => uriByPath.has(p)).map((p) => [p, uriByPath.get(p)!]))
    };
  }
}

const SEV = ['info', 'low', 'medium', 'high', 'critical'] as const;
const CONF = ['low', 'medium', 'high'] as const;

export function mergeAnalyses(list: AIAnalysis[]): AIAnalysis {
  if (list.length === 1) {
    return list[0];
  }
  const seen = new Set<string>();
  const uniq = <T extends { title: string }>(items: T[]) =>
    items.filter((x) => {
      const k = x.title.toLowerCase();
      if (seen.has(k)) {
        return false;
      }
      seen.add(k);
      return true;
    });
  return {
    summary: list.map((a) => a.summary).join('\n\n').slice(0, 8000),
    observations: uniq(list.flatMap((a) => a.observations)).slice(0, 40),
    recommendations: uniq(list.flatMap((a) => a.recommendations)).slice(0, 40),
    overallSeverity: SEV[Math.max(...list.map((a) => SEV.indexOf(a.overallSeverity)))],
    overallConfidence: CONF[Math.min(...list.map((a) => CONF.indexOf(a.overallConfidence)))]
  };
}
