import type { LanguageStat, Technology, TechnologyEvidence, TechnologyReport } from '../../models/types';
import type { DiscoveredFile } from '../../core/fileDiscovery';
import { TECHNOLOGIES, packageMatches, type TechnologyDefinition } from './catalog';
import type { ProjectManifestInfo } from './manifests';

export interface TechnologyInputs {
  files: DiscoveredFile[];
  manifests: ProjectManifestInfo;
  /** package name → files importing it (display path + uri). */
  imports: Map<string, { file: string; uri: string }[]>;
  /** technology id → files where a content signal matched. */
  contentSignals: Map<string, { file: string; uri: string }[]>;
  languages: LanguageStat[];
}

const MAX_EVIDENCE = 6;

function cleanVersion(range: string): string {
  return range.replace(/^[\^~>=<\s]+/, '').split(/\s|\|\|/)[0];
}

/**
 * Combines manifests, imports, config files and content signals. A technology that is
 * only declared as a dependency is reported as `declared` with low confidence rather
 * than claimed as used.
 */
export function detectTechnologies(inputs: TechnologyInputs): TechnologyReport {
  const { manifests } = inputs;
  const technologies: Technology[] = [];
  const allScripts = manifests.packages.flatMap((p) => Object.entries(p.scripts).map(([k, v]) => ({ name: k, cmd: v, file: p.file })));

  for (const def of TECHNOLOGIES) {
    const evidence: TechnologyEvidence[] = [];
    let importCount = 0;
    let configured = false;
    let version: string | undefined;
    let resolvedVersion: string | undefined;
    let declared = false;

    for (const dep of manifests.dependencies) {
      if (def.packages?.some((p) => packageMatches(p, dep.name))) {
        declared = true;
        version ??= cleanVersion(dep.range);
        resolvedVersion ??= manifests.resolvedVersions.get(dep.name);
        if (evidence.length < MAX_EVIDENCE) {
          evidence.push({ kind: dep.dev ? 'devDependency' : 'dependency', detail: `${dep.name}@${dep.range}`, file: dep.manifest });
        }
      }
    }

    for (const [pkg, files] of inputs.imports) {
      if (def.packages?.some((p) => packageMatches(p, pkg))) {
        importCount += files.length;
        for (const f of files.slice(0, 2)) {
          if (evidence.length < MAX_EVIDENCE * 2) {
            evidence.push({ kind: 'import', detail: `imports ${pkg}`, file: f.file, uri: f.uri });
          }
        }
      }
    }

    if (def.configFiles) {
      const configs = inputs.files.filter((f) => def.configFiles!.test(f.relPath));
      if (configs.length) {
        configured = true;
        for (const f of configs.slice(0, 3)) {
          evidence.push({ kind: 'config-file', detail: f.relPath, file: f.displayPath, uri: f.uri });
        }
      }
    }

    if (def.scripts) {
      const script = allScripts.find((s) => def.scripts!.test(s.cmd));
      if (script) {
        configured = true;
        evidence.push({ kind: 'script', detail: `"${script.name}": "${script.cmd.slice(0, 80)}"`, file: script.file.displayPath, uri: script.file.uri });
      }
    }

    const signals = inputs.contentSignals.get(def.id);
    if (signals?.length) {
      configured = true;
      for (const f of signals.slice(0, 2)) {
        evidence.push({ kind: 'file-pattern', detail: 'content signature', file: f.file, uri: f.uri });
      }
    }

    if (!declared && importCount === 0 && !configured) {
      continue;
    }

    const usage: Technology['usage'] = importCount > 0 ? 'used' : configured ? 'configured' : 'declared';
    // Imports or config + manifest agreement are strong evidence; a bare dependency entry is weak.
    const confidence: Technology['confidence'] = importCount > 0 || (configured && declared) ? 'high' : configured ? 'medium' : 'low';

    technologies.push({
      id: def.id,
      name: def.name,
      category: def.category,
      version,
      resolvedVersion,
      usage,
      confidence,
      evidence,
      importCount
    });
  }

  const primary = pickPrimaryFramework(technologies);

  return {
    languages: inputs.languages,
    technologies: technologies.sort((a, b) => a.category.localeCompare(b.category) || b.importCount - a.importCount || a.name.localeCompare(b.name)),
    packageManager: manifests.packageManager,
    primaryFramework: primary,
    dependencies: manifests.dependencies.map((d) => ({ ...d, resolved: manifests.resolvedVersions.get(d.name) })),
    manifests: manifests.packages.map((p) => p.file.displayPath)
  };
}

function pickPrimaryFramework(techs: Technology[]): string | undefined {
  const rank = (t: Technology) => (TECHNOLOGIES.find((d: TechnologyDefinition) => d.id === t.id)?.frameworkRank ?? 99) + (t.usage === 'declared' ? 50 : 0);
  const candidates = techs.filter((t) => rank(t) < 99).sort((a, b) => rank(a) - rank(b));
  return candidates[0]?.name;
}

export function hasTechnology(report: TechnologyReport, id: string, minUsage: 'declared' | 'configured' | 'used' = 'configured'): boolean {
  const order = { declared: 0, configured: 1, used: 2 };
  const tech = report.technologies.find((t) => t.id === id);
  return !!tech && order[tech.usage] >= order[minUsage];
}
