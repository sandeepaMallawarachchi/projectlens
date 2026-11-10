import { aiAnalysisSchema, type AIAnalysis } from '../models/ai';
import { AIError } from './errors';

/** Extracts the first JSON object from model output (handles code fences and leading prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) {
    candidates.push(fence[1].trim());
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  throw new AIError('invalid-response', 'Response is not valid JSON.');
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(s: string): string {
  return s.replace(CONTROL, '').trim();
}

export interface ParsedAnalysis {
  analysis: AIAnalysis;
  droppedReferences: number;
}

/**
 * Validates AI output with Zod and removes file references that are not backed by the
 * provided context. AI output is untrusted: it is never executed or applied to files.
 */
export function parseAnalysis(text: string, allowedPaths: Set<string>): ParsedAnalysis {
  const json = extractJson(text);
  const parsed = aiAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new AIError('invalid-response', `Schema validation failed: ${issues}`);
  }
  let dropped = 0;
  const filterRefs = (refs: { path: string; line: number }[]) =>
    refs.filter((r) => {
      const path = r.path.replace(/^\.?\//, '');
      const ok = allowedPaths.has(path);
      if (!ok) {
        dropped++;
      }
      r.path = path;
      return ok;
    });
  const a = parsed.data;
  const analysis: AIAnalysis = {
    summary: clean(a.summary),
    overallSeverity: a.overallSeverity,
    overallConfidence: a.overallConfidence,
    observations: a.observations.map((o) => ({ ...o, title: clean(o.title), detail: clean(o.detail), fileReferences: filterRefs(o.fileReferences) })),
    recommendations: a.recommendations.map((r) => ({ ...r, title: clean(r.title), detail: clean(r.detail), fileReferences: filterRefs(r.fileReferences) }))
  };
  return { analysis, droppedReferences: dropped };
}
