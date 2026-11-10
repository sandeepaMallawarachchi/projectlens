import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Finding, PlaceholderLocation } from '../models/types';
import type { FileFacts } from '../analyzers/progress/facts';
import type { FileRoles } from './fileContext';

/** Bump whenever analyzer output changes so stale cache entries are discarded. */
export const ANALYZER_VERSION = 4;

export interface CachedFileAnalysis {
  stamp: string;
  findings: Finding[];
  facts: FileFacts;
  roles: FileRoles;
  lines: number;
  parsed: boolean;
  lintError?: string;
  contentSignals: string[];
  markerPlaceholders: PlaceholderLocation[];
  apiProxy: boolean;
}

/** Per-file analysis cache keyed by URI. Contains redacted findings and structural facts only — no source text. */
export class AnalysisCache {
  private entries = new Map<string, CachedFileAnalysis>();
  private dirty = false;

  static stamp(mtimeMs: number, size: number, mode: string): string {
    return `${ANALYZER_VERSION}:${mode}:${Math.round(mtimeMs)}:${size}`;
  }

  get(key: string, stamp: string): CachedFileAnalysis | undefined {
    const entry = this.entries.get(key);
    return entry && entry.stamp === stamp ? entry : undefined;
  }

  set(key: string, value: CachedFileAnalysis): void {
    this.entries.set(key, value);
    this.dirty = true;
  }

  /** Drops entries for files that no longer exist. */
  retain(keys: Set<string>): void {
    for (const key of this.entries.keys()) {
      if (!keys.has(key)) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.dirty = true;
  }

  async load(file: string): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { version?: number; entries?: [string, CachedFileAnalysis][] };
      if (raw.version === ANALYZER_VERSION && Array.isArray(raw.entries)) {
        this.entries = new Map(raw.entries);
      }
    } catch {
      this.entries = new Map();
    }
    this.dirty = false;
  }

  async save(file: string): Promise<void> {
    if (!this.dirty) {
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: ANALYZER_VERSION, entries: [...this.entries] }), 'utf8');
    this.dirty = false;
  }
}
