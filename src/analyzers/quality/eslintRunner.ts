import type { Finding, Severity } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';

/**
 * Runs ESLint's in-memory `Linter` with a built-in rule set. The workspace's own
 * ESLint configuration is intentionally NOT loaded: flat configs are JavaScript
 * and loading them would execute repository code.
 */

interface RuleInfo {
  severity: Severity;
  title: string;
  recommendation: string;
  options?: unknown[];
}

const LINT_RULES: Record<string, RuleInfo> = {
  '@typescript-eslint/no-unused-vars': {
    severity: 'low',
    title: 'Unused variable',
    recommendation: 'Remove the unused binding or prefix it with `_` if it is intentionally unused.',
    options: [{ args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_|^React$', caughtErrors: 'none', ignoreRestSiblings: true }]
  },
  'no-unreachable': { severity: 'medium', title: 'Unreachable code', recommendation: 'Remove code after return/throw/break.' },
  'no-fallthrough': { severity: 'medium', title: 'Switch case fallthrough', recommendation: 'Add `break`/`return`, or a `// falls through` comment if intentional.' },
  'no-self-compare': { severity: 'medium', title: 'Comparison with itself', recommendation: 'Compare against the intended value; use Number.isNaN for NaN checks.' },
  'no-dupe-keys': { severity: 'medium', title: 'Duplicate object key', recommendation: 'Remove or rename the duplicated key.' },
  'no-duplicate-case': { severity: 'medium', title: 'Duplicate switch case', recommendation: 'Remove the duplicated case label.' },
  'no-unsafe-finally': { severity: 'medium', title: 'Control flow in finally', recommendation: 'Avoid return/throw inside finally blocks.' },
  'no-async-promise-executor': { severity: 'medium', title: 'Async Promise executor', recommendation: 'Do not pass an async function to `new Promise`; errors will be lost.' },
  'no-unsafe-optional-chaining': { severity: 'medium', title: 'Unsafe optional chaining', recommendation: 'Provide a fallback before using the optional chain result.' },
  'no-constant-condition': { severity: 'low', title: 'Constant condition', recommendation: 'Remove dead branches or use an explicit loop condition.', options: [{ checkLoops: false }] },
  'no-debugger': { severity: 'medium', title: 'Debugger statement', recommendation: 'Remove `debugger` statements before shipping.' },
  'no-useless-catch': { severity: 'low', title: 'Useless catch', recommendation: 'Remove catch blocks that only rethrow.' },
  'no-var': { severity: 'low', title: '`var` declaration', recommendation: 'Use `const` or `let` for block scoping.' },
  'prefer-const': { severity: 'info', title: 'Prefer const', recommendation: 'Declare never-reassigned bindings with `const`.' },
  eqeqeq: { severity: 'low', title: 'Loose equality', recommendation: 'Use `===`/`!==` to avoid coercion surprises.', options: ['always', { null: 'ignore' }] },
  'no-loss-of-precision': { severity: 'medium', title: 'Numeric precision loss', recommendation: 'Use BigInt or a string for very large numbers.' },
  'no-shadow-restricted-names': { severity: 'medium', title: 'Shadowed restricted name', recommendation: 'Rename the binding (e.g. `undefined`, `NaN`).' }
};

const FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];

interface LinterLike {
  verify(code: string, config: unknown, options: { filename: string }): { ruleId: string | null; message: string; line: number; column: number; endLine?: number; endColumn?: number; fatal?: boolean; severity: number }[];
}

let cached: { linter: LinterLike; config: unknown[] } | null | undefined;
let loadError: string | undefined;

function load(): { linter: LinterLike; config: unknown[] } | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linter } = require('eslint') as { Linter: new (opts?: unknown) => LinterLike };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tseslint = require('typescript-eslint') as { parser: unknown; plugin: unknown };
    const rules: Record<string, unknown> = {};
    for (const [id, info] of Object.entries(LINT_RULES)) {
      rules[id] = info.options ? ['warn', ...info.options] : 'warn';
    }
    const config = [
      {
        files: FILES,
        languageOptions: {
          parser: tseslint.parser,
          ecmaVersion: 'latest',
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } }
        },
        plugins: { '@typescript-eslint': tseslint.plugin },
        linterOptions: { reportUnusedDisableDirectives: 'off', noInlineConfig: false },
        rules
      }
    ];
    cached = { linter: new Linter({ configType: 'flat' }), config };
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    cached = null;
  }
  return cached;
}

export function eslintAvailability(): { available: boolean; reason?: string } {
  const loaded = load();
  return loaded ? { available: true } : { available: false, reason: `ESLint could not be loaded: ${loadError}` };
}

export function runEslint(ctx: FileContext): { findings: Finding[]; error?: string } {
  const loaded = load();
  if (!loaded) {
    return { findings: [], error: loadError };
  }
  let messages;
  try {
    messages = loaded.linter.verify(ctx.text, loaded.config, { filename: ctx.file.relPath });
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
  const findings: Finding[] = [];
  for (const msg of messages) {
    if (msg.fatal || !msg.ruleId) {
      // Parse errors are reported as coverage limitations, not findings.
      if (msg.fatal) {
        return { findings: [], error: `Parse error at line ${msg.line}: ${msg.message}` };
      }
      continue;
    }
    const info = LINT_RULES[msg.ruleId];
    if (!info) {
      continue;
    }
    const rule: RuleMeta = {
      id: `eslint/${msg.ruleId}`,
      title: info.title,
      category: 'quality',
      severity: info.severity,
      confidence: 'high',
      analyzer: 'eslint',
      description: msg.message,
      recommendation: info.recommendation
    };
    findings.push(findingAt(ctx, rule, { line: msg.line, column: msg.column, endLine: msg.endLine, endColumn: msg.endColumn }));
    if (findings.length >= 60) {
      break;
    }
  }
  return { findings };
}
