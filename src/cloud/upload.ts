import type { ScanResult } from '../models/types';

const MAX_UPLOAD_FINDINGS = 3000;

/** Keeps uploads within the server's limits (findings are already sorted by severity). */
export function trimForUpload(result: ScanResult): ScanResult {
  return {
    ...result,
    findings: result.findings.slice(0, MAX_UPLOAD_FINDINGS).map((f) => ({ ...f, evidence: f.evidence.slice(0, 2000) })),
    progress: {
      ...result.progress,
      placeholders: result.progress.placeholders.slice(0, 300),
      modules: result.progress.modules.map((m) => ({ ...m, evidence: m.evidence.slice(0, 40) }))
    },
    technology: { ...result.technology, dependencies: result.technology.dependencies.slice(0, 500) },
    warnings: result.warnings.slice(0, 100)
  };
}
