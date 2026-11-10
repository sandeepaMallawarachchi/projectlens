import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { parseWebviewMessage } from '../../src/models/messages';
import { resolveNavigationTarget } from '../../src/views/navigation';
import { fileUri } from '../../src/utils/paths';
import { AnalysisCache } from '../../src/core/cache';
import { scanDir, tempDir } from './helpers';

describe('webview message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseWebviewMessage({ type: 'scan', mode: 'full' })).toEqual({ type: 'scan', mode: 'full' });
    expect(parseWebviewMessage({ type: 'openFile', uri: 'file:///w/a.ts', line: 3, column: 2 })).toMatchObject({ type: 'openFile', line: 3 });
    expect(parseWebviewMessage({ type: 'aiRun', task: 'explainFinding', findingId: 'abc' })).toMatchObject({ task: 'explainFinding' });
  });

  it('rejects unknown or malformed messages', () => {
    expect(parseWebviewMessage({ type: 'runShell', cmd: 'rm -rf /' })).toBeNull();
    expect(parseWebviewMessage({ type: 'scan', mode: 'deep' })).toBeNull();
    expect(parseWebviewMessage({ type: 'openFile', uri: 'file:///a', line: -1 })).toBeNull();
    expect(parseWebviewMessage({ type: 'aiRun', task: 'deleteFiles' })).toBeNull();
    expect(parseWebviewMessage({ type: 'setModel', model: 'x"; rm' })).toBeNull();
    expect(parseWebviewMessage('scan')).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
  });
});

describe('file navigation', () => {
  const root = path.resolve('/workspace/project');

  it('resolves files inside the workspace', () => {
    const target = resolveNavigationTarget({ uri: fileUri(path.join(root, 'src/a.ts')), line: 12, column: 4 }, [root]);
    expect(target).toEqual({ fsPath: path.join(root, 'src/a.ts'), line: 12, column: 4, endLine: undefined, endColumn: undefined });
  });

  it('refuses files outside the workspace, traversal and non-file URIs', () => {
    expect(resolveNavigationTarget({ uri: fileUri('/etc/passwd') }, [root])).toBeNull();
    expect(resolveNavigationTarget({ uri: 'file:///workspace/project/../other/secret.txt' }, [root])).toBeNull();
    expect(resolveNavigationTarget({ uri: 'https://example.com/a.ts' }, [root])).toBeNull();
    expect(resolveNavigationTarget({ uri: 'vscode-userdata:/settings.json' }, [root])).toBeNull();
    expect(resolveNavigationTarget({ uri: fileUri('/workspace/project-evil/a.ts') }, [root])).toBeNull();
  });

  it('defaults and clamps line/column values', () => {
    const t = resolveNavigationTarget({ uri: fileUri(path.join(root, 'a.ts')), endLine: 0 }, [root])!;
    expect(t.line).toBe(1);
    expect(t.column).toBe(1);
    expect(t.endLine).toBeUndefined();
  });
});

describe('analysis cache', () => {
  it('reuses unchanged file analysis and persists to disk', async () => {
    const dir = await tempDir({ 'src/a.ts': 'export const a: any = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
    const cache = new AnalysisCache();
    const first = await scanDir(dir, 'full', { cache });
    expect(first.coverage.cacheHits).toBe(0);
    const second = await scanDir(dir, 'full', { cache });
    expect(second.coverage.cacheHits).toBe(2);
    expect(second.findings.map((f) => f.id).sort()).toEqual(first.findings.map((f) => f.id).sort());
    const file = path.join(dir, '.cache-test.json');
    await cache.save(file);
    const restored = new AnalysisCache();
    await restored.load(file);
    expect(restored.size).toBe(2);
  });
});
