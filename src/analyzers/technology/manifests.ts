import { promises as fs } from 'node:fs';
import ts from 'typescript';
import type { DependencyInfo } from '../../models/types';
import type { DiscoveredFile } from '../../core/fileDiscovery';

export interface PackageManifest {
  file: DiscoveredFile;
  name?: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  packageManager?: string;
  workspaces?: string[];
}

export interface ProjectManifestInfo {
  packages: PackageManifest[];
  dependencies: DependencyInfo[];
  resolvedVersions: Map<string, string>;
  packageManager?: string;
  lockfiles: string[];
  tsconfig?: { file: string; strict: boolean | undefined; parsed: boolean };
  hasReadme: boolean;
  hasCi: boolean;
  hasLintConfig: boolean;
  hasGitignore: Map<string, boolean>;
  gitignoreCoversEnv: boolean;
  hasEnvExample: boolean;
  hasDockerfile: boolean;
  hasDeployConfig: boolean;
  configFiles: string[];
  warnings: string[];
}

const MAX_LOCKFILE_BYTES = 30 * 1024 * 1024;

async function readText(file: DiscoveredFile, limit: number): Promise<string | null> {
  if (file.size > limit) {
    return null;
  }
  try {
    return await fs.readFile(file.absPath, 'utf8');
  } catch {
    return null;
  }
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

export function parsePackageJson(text: string): Omit<PackageManifest, 'file'> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') {
    return null;
  }
  const obj = json as Record<string, unknown>;
  const workspaces = Array.isArray(obj.workspaces)
    ? obj.workspaces.filter((w): w is string => typeof w === 'string')
    : obj.workspaces && typeof obj.workspaces === 'object' && Array.isArray((obj.workspaces as { packages?: unknown }).packages)
      ? ((obj.workspaces as { packages: unknown[] }).packages.filter((w): w is string => typeof w === 'string'))
      : undefined;
  return {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    scripts: asStringRecord(obj.scripts),
    dependencies: { ...asStringRecord(obj.dependencies), ...asStringRecord(obj.peerDependencies) },
    devDependencies: asStringRecord(obj.devDependencies),
    packageManager: typeof obj.packageManager === 'string' ? obj.packageManager : undefined,
    workspaces
  };
}

/** Extracts resolved versions from npm (v1–v3), pnpm and yarn lockfiles. */
export function parseLockfile(fileName: string, text: string): Map<string, string> {
  const versions = new Map<string, string>();
  if (/package-lock\.json$|npm-shrinkwrap\.json$/.test(fileName)) {
    try {
      const json = JSON.parse(text) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
      for (const [key, value] of Object.entries(json.packages ?? {})) {
        const idx = key.lastIndexOf('node_modules/');
        if (idx >= 0 && value?.version && key.indexOf('node_modules/', idx + 1) < 0) {
          const name = key.slice(idx + 'node_modules/'.length);
          if (!key.slice(0, idx).includes('node_modules') && !versions.has(name)) {
            versions.set(name, value.version);
          }
        }
      }
      for (const [name, value] of Object.entries(json.dependencies ?? {})) {
        if (value?.version && !versions.has(name)) {
          versions.set(name, value.version);
        }
      }
    } catch {
      // Malformed lockfile — versions unavailable.
    }
  } else if (/pnpm-lock\.yaml$/.test(fileName)) {
    const re = /^ {2}'?\/?((?:@[^/@\s']+\/)?[^@\s/']+)@(\d[^:('\s]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!versions.has(m[1])) {
        versions.set(m[1], m[2]);
      }
    }
  } else if (/yarn\.lock$/.test(fileName)) {
    const lines = text.split(/\r?\n/);
    let current: string | null = null;
    for (const line of lines) {
      const header = /^"?((?:@[^/@\s"]+\/)?[^@\s"]+)@[^\n]*:\s*$/.exec(line);
      if (header && !line.startsWith(' ')) {
        current = header[1];
        continue;
      }
      const version = /^ {2}version:? "?([^"\s]+)"?/.exec(line);
      if (version && current) {
        if (!versions.has(current)) {
          versions.set(current, version[1]);
        }
        current = null;
      }
    }
  }
  return versions;
}

export function parseTsconfigStrict(text: string): { strict: boolean | undefined; parsed: boolean } {
  const result = ts.parseConfigFileTextToJson('tsconfig.json', text);
  if (result.error || !result.config) {
    return { strict: undefined, parsed: false };
  }
  const opts = (result.config as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {};
  if (typeof opts.strict === 'boolean') {
    return { strict: opts.strict, parsed: true };
  }
  return { strict: undefined, parsed: true };
}

export async function collectManifests(files: DiscoveredFile[], roots: string[]): Promise<ProjectManifestInfo> {
  const info: ProjectManifestInfo = {
    packages: [],
    dependencies: [],
    resolvedVersions: new Map(),
    lockfiles: [],
    hasReadme: false,
    hasCi: false,
    hasLintConfig: false,
    hasGitignore: new Map(roots.map((r) => [r, false])),
    gitignoreCoversEnv: false,
    hasEnvExample: false,
    hasDockerfile: false,
    hasDeployConfig: false,
    configFiles: [],
    warnings: []
  };

  for (const file of files) {
    const rel = file.relPath;
    const depth = rel.split('/').length;
    if (/(^|\/)package\.json$/.test(rel) && depth <= 4) {
      const text = await readText(file, 5 * 1024 * 1024);
      const parsed = text ? parsePackageJson(text) : null;
      if (parsed) {
        info.packages.push({ file, ...parsed });
        for (const [name, range] of Object.entries(parsed.dependencies)) {
          info.dependencies.push({ name, range, dev: false, manifest: file.displayPath });
        }
        for (const [name, range] of Object.entries(parsed.devDependencies)) {
          info.dependencies.push({ name, range, dev: true, manifest: file.displayPath });
        }
        info.packageManager ??= parsed.packageManager?.split('@')[0];
      } else {
        info.warnings.push(`Could not parse ${file.displayPath}.`);
      }
    } else if (/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(rel) && depth <= 3) {
      info.lockfiles.push(file.displayPath);
      const text = /bun\.lockb$/.test(rel) ? null : await readText(file, MAX_LOCKFILE_BYTES);
      if (text) {
        for (const [name, version] of parseLockfile(rel, text)) {
          if (!info.resolvedVersions.has(name)) {
            info.resolvedVersions.set(name, version);
          }
        }
      }
    } else if (/^tsconfig\.json$/.test(rel) || (!info.tsconfig && /(^|\/)tsconfig\.json$/.test(rel) && depth <= 3)) {
      const text = await readText(file, 1024 * 1024);
      if (text) {
        info.tsconfig = { file: file.displayPath, ...parseTsconfigStrict(text) };
      }
    }
    if (/^readme(\.\w+)?$/i.test(rel)) {
      info.hasReadme = true;
    }
    if (/(^|\/)(\.github\/workflows\/[\w.-]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile|bitbucket-pipelines\.yml)$/.test(rel)) {
      info.hasCi = true;
    }
    if (/(^|\/)(eslint\.config\.(js|mjs|cjs|ts)|\.eslintrc(\.\w+)?|biome\.jsonc?)$/.test(rel)) {
      info.hasLintConfig = true;
    }
    if (/^\.gitignore$/.test(rel)) {
      info.hasGitignore.set(file.root, true);
      const text = await readText(file, 256 * 1024);
      if (text && /^\s*\/?\.env(\*|\.local|\.\*|$)/m.test(text)) {
        info.gitignoreCoversEnv = true;
      }
    }
    if (/(^|\/)\.env\.(example|sample|template)$/.test(rel)) {
      info.hasEnvExample = true;
    }
    if (/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(rel)) {
      info.hasDockerfile = true;
    }
    if (/(^|\/)(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|app\.yaml|Procfile|serverless\.ya?ml|railway\.json)$/.test(rel)) {
      info.hasDeployConfig = true;
    }
    if (/\.config\.[cm]?[jt]s$|(^|\/)(tsconfig[\w.-]*\.json|vercel\.json|Dockerfile|docker-compose\.ya?ml|schema\.prisma)$/.test(rel)) {
      info.configFiles.push(file.displayPath);
    }
  }

  if (!info.packageManager) {
    const lf = info.lockfiles.join(' ');
    info.packageManager = /pnpm-lock/.test(lf) ? 'pnpm' : /yarn\.lock/.test(lf) ? 'yarn' : /bun\.lock/.test(lf) ? 'bun' : /package-lock|shrinkwrap/.test(lf) ? 'npm' : info.packages.length ? 'npm (no lockfile)' : undefined;
  }
  return info;
}
