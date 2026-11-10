import * as path from 'node:path';
import { uriToPath, isInside } from '../utils/paths';

export interface NavigationTarget {
  fsPath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Validates a navigation request from a webview. Only `file:` URIs located inside an
 * open workspace folder are accepted, so a compromised webview cannot open arbitrary files.
 */
export function resolveNavigationTarget(
  msg: { uri: string; line?: number; column?: number; endLine?: number; endColumn?: number },
  workspaceRoots: string[]
): NavigationTarget | null {
  const fsPath = uriToPath(msg.uri);
  if (!fsPath) {
    return null;
  }
  const normalized = path.resolve(fsPath);
  if (!workspaceRoots.some((root) => isInside(root, normalized))) {
    return null;
  }
  const line = Math.max(1, Math.floor(msg.line ?? 1));
  const column = Math.max(1, Math.floor(msg.column ?? 1));
  const endLine = msg.endLine && msg.endLine >= line ? Math.floor(msg.endLine) : undefined;
  return { fsPath: normalized, line, column, endLine, endColumn: endLine ? msg.endColumn : undefined };
}
