import { describe, expect, it } from 'vitest';
import { analyzeQualityAst, cyclomaticComplexity } from '../../src/analyzers/quality/qualityAstRules';
import { runEslint } from '../../src/analyzers/quality/eslintRunner';
import { analyzeMarkers } from '../../src/analyzers/quality/markers';
import { computeDuplicateHashes, findDuplicates } from '../../src/analyzers/quality/duplicates';
import { ctxFor, scanFixture } from './helpers';
import ts from 'typescript';

const rules = (file: string, code: string) => analyzeQualityAst(ctxFor(file, code)).findings.map((f) => f.ruleId);

describe('quality AST rules', () => {
  it('detects unsafe TypeScript patterns', () => {
    expect(rules('a.ts', 'export function f(x: any) { return x; }')).toContain('ts/explicit-any');
    expect(rules('a.ts', 'const y = x as any;')).toContain('ts/unsafe-assertion');
    expect(rules('a.ts', 'const y = x as unknown as Foo;')).toContain('ts/unsafe-assertion');
    expect(rules('a.ts', '// @ts-ignore\nconst y = 1;')).toContain('ts/suppressed-error');
    expect(rules('a.js', 'function f(x) { return x; }')).not.toContain('ts/explicit-any');
  });

  it('detects empty catch blocks but allows documented ones', () => {
    expect(rules('a.ts', 'try { f(); } catch (e) {}')).toContain('quality/empty-catch');
    expect(rules('a.ts', 'try { f(); } catch { /* optional feature */ }')).not.toContain('quality/empty-catch');
  });

  it('detects complexity, nesting and parameter count', () => {
    const branches = Array.from({ length: 16 }, (_, i) => `if (x === ${i}) { return ${i}; }`).join('\n');
    expect(rules('a.ts', `function big(x: number) {\n${branches}\nreturn -1; }`)).toContain('quality/complex-function');
    const nested = 'function n(a: number) { if (a) { for (const b of [1]) { while (b) { if (b) { if (a) { return 1; } } } } } return 0; }';
    expect(rules('a.ts', nested)).toContain('quality/deep-nesting');
    expect(rules('a.ts', 'function p(a: number, b: number, c: number, d: number, e: number, f: number) { return a; }')).toContain('quality/too-many-parameters');
  });

  it('computes cyclomatic complexity', () => {
    const sf = ts.createSourceFile('a.ts', 'function f(a, b) { if (a && b) { return 1; } return a ? 2 : 3; }', ts.ScriptTarget.Latest, true);
    const fn = sf.statements[0];
    expect(cyclomaticComplexity(fn)).toBe(4);
  });

  it('detects floating promise chains and async handlers without try/catch', () => {
    expect(rules('src/a.ts', 'fetch(u).then((r) => r.json());')).toContain('quality/unhandled-promise');
    expect(rules('src/a.ts', 'fetch(u).then((r) => r.json()).catch(log);')).not.toContain('quality/unhandled-promise');
    expect(rules('src/a.ts', 'async function f() { await fetch(u).then((r) => r.json()); }')).not.toContain('quality/unhandled-promise');
    expect(rules('app/api/x/route.ts', 'export async function POST(req: Request) { const b = await req.json(); return Response.json(b); }')).toContain('quality/async-handler-no-error-handling');
  });

  it('flags console statements only in server code', () => {
    expect(rules('src/routes/users.ts', 'console.log("x");')).toContain('quality/console-in-server');
    expect(rules('src/components/A.tsx', 'console.log("x");')).not.toContain('quality/console-in-server');
  });
});

describe('ESLint integration', () => {
  it('reports unused variables and loose equality with the built-in rule set', () => {
    const { findings, error } = runEslint(ctxFor('src/a.ts', 'const unused = 1;\nexport const ok = (a: number) => a == 2;\n'));
    expect(error).toBeUndefined();
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain('eslint/@typescript-eslint/no-unused-vars');
    expect(ids).toContain('eslint/eqeqeq');
    expect(findings.every((f) => f.analyzer === 'eslint')).toBe(true);
  });

  it('parses JSX in .js files and reports parse errors as errors, not findings', () => {
    expect(runEslint(ctxFor('src/a.js', 'export const A = () => <div />;\n')).error).toBeUndefined();
    const bad = runEslint(ctxFor('src/b.ts', 'const = ;'));
    expect(bad.findings).toHaveLength(0);
    expect(bad.error).toMatch(/Parse error/);
  });
});

describe('markers and duplicates', () => {
  it('collects TODO/FIXME markers in comments', () => {
    const { findings, placeholders } = analyzeMarkers(ctxFor('a.ts', '// TODO: wire API\nconst a = 1; /* FIXME broken */\nconst todo = "TODO in string";\n'));
    expect(findings.map((f) => f.ruleId)).toEqual(['marker/todo', 'marker/fixme']);
    expect(placeholders[0]).toMatchObject({ kind: 'todo', line: 1, detail: 'wire API' });
  });

  it('detects duplicated blocks across files', () => {
    const block = Array.from({ length: 10 }, (_, i) => `const value${i} = computeSomethingInteresting(input${i}, options);`).join('\n');
    const a = computeDuplicateHashes(block.split('\n'));
    const b = computeDuplicateHashes(`// header\n${block}`.split('\n'));
    const found = findDuplicates([
      { file: 'a.ts', uri: 'file:///a.ts', hashes: a, isTest: false },
      { file: 'b.ts', uri: 'file:///b.ts', hashes: b, isTest: false }
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].location.file).toBe('b.ts');
    expect(found[0].description).toContain('a.ts:1');
  });

  it('finds quality issues in the vulnerable fixture', async () => {
    const r = await scanFixture('vulnerable-app');
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(['quality/empty-catch', 'ts/explicit-any', 'ts/unsafe-assertion', 'ts/suppressed-error', 'quality/deep-nesting', 'quality/complex-function', 'marker/fixme']));
    expect(r.scores.quality.score).not.toBeNull();
    expect(r.scores.quality.score!).toBeLessThan(60);
  });
});
