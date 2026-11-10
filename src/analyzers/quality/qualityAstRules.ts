import ts from 'typescript';
import type { Finding } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { lineOf, walk } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';

const base = { category: 'quality', analyzer: 'quality-ast' } as const;

export const QUALITY_THRESHOLDS = {
  complexity: 15,
  functionLines: 100,
  nesting: 4,
  parameters: 5,
  fileLines: 600
};

export const QUALITY_RULES = {
  explicitAny: {
    ...base,
    id: 'ts/explicit-any',
    title: 'Explicit `any` type',
    severity: 'low',
    confidence: 'high',
    description: 'An explicit `any` disables type checking for this value.',
    recommendation: 'Use a precise type, a generic, or `unknown` with narrowing.'
  },
  unsafeAssertion: {
    ...base,
    id: 'ts/unsafe-assertion',
    title: 'Unsafe type assertion',
    severity: 'medium',
    confidence: 'high',
    description: '`as any` or a double assertion (`as unknown as T`) bypasses the type system.',
    recommendation: 'Validate the value at runtime (e.g. with Zod) or fix the underlying type mismatch.'
  },
  nonNullAssertion: {
    ...base,
    id: 'ts/non-null-assertion',
    title: 'Non-null assertion',
    severity: 'info',
    confidence: 'high',
    kind: 'recommendation',
    description: 'The `!` operator asserts a value is not null/undefined without a runtime check.',
    recommendation: 'Prefer explicit narrowing or optional chaining with a fallback.'
  },
  tsIgnore: {
    ...base,
    id: 'ts/suppressed-error',
    title: 'Type checking suppressed',
    severity: 'medium',
    confidence: 'high',
    description: '`@ts-ignore`/`@ts-nocheck` hides compiler errors.',
    recommendation: 'Fix the type error or use `@ts-expect-error` with a justification comment.'
  },
  emptyCatch: {
    ...base,
    id: 'quality/empty-catch',
    title: 'Empty catch block',
    severity: 'medium',
    confidence: 'high',
    description: 'Errors are caught and silently discarded.',
    recommendation: 'Handle the error, log it with context, or rethrow. If ignoring is intended, add an explanatory comment.'
  },
  catchOnlyLogs: {
    ...base,
    id: 'quality/catch-only-logs',
    title: 'Error swallowed after logging',
    severity: 'low',
    confidence: 'medium',
    kind: 'recommendation',
    description: 'The catch block only logs the error and continues as if the operation succeeded.',
    recommendation: 'Propagate the failure to the caller or return an explicit error result.'
  },
  complexFunction: {
    ...base,
    id: 'quality/complex-function',
    title: 'High cyclomatic complexity',
    severity: 'medium',
    confidence: 'high',
    description: `The function has more than ${QUALITY_THRESHOLDS.complexity} independent paths.`,
    recommendation: 'Split the function into smaller units, use early returns, or replace conditionals with lookup tables.'
  },
  longFunction: {
    ...base,
    id: 'quality/long-function',
    title: 'Long function',
    severity: 'low',
    confidence: 'high',
    description: `The function body is longer than ${QUALITY_THRESHOLDS.functionLines} lines.`,
    recommendation: 'Extract cohesive blocks into well-named helper functions.'
  },
  deepNesting: {
    ...base,
    id: 'quality/deep-nesting',
    title: 'Excessive nesting',
    severity: 'medium',
    confidence: 'high',
    description: `Control flow is nested more than ${QUALITY_THRESHOLDS.nesting} levels deep.`,
    recommendation: 'Use guard clauses and extract nested blocks into functions.'
  },
  tooManyParams: {
    ...base,
    id: 'quality/too-many-parameters',
    title: 'Too many parameters',
    severity: 'low',
    confidence: 'high',
    kind: 'recommendation',
    description: `The function declares more than ${QUALITY_THRESHOLDS.parameters} parameters.`,
    recommendation: 'Group related parameters into an options object.'
  },
  largeFile: {
    ...base,
    id: 'quality/large-file',
    title: 'Large source file',
    severity: 'low',
    confidence: 'high',
    kind: 'recommendation',
    description: `The file has more than ${QUALITY_THRESHOLDS.fileLines} lines.`,
    recommendation: 'Split the file by responsibility to improve navigability and reviewability.'
  },
  unhandledPromise: {
    ...base,
    id: 'quality/unhandled-promise',
    title: 'Promise chain without rejection handler',
    severity: 'low',
    confidence: 'medium',
    description: 'A `.then()` chain has no `.catch()` and is neither awaited nor returned.',
    recommendation: 'Add `.catch()` or use `await` inside `try/catch` so failures are not silently dropped.'
  },
  asyncRouteNoTry: {
    ...base,
    id: 'quality/async-handler-no-error-handling',
    title: 'Async route handler without error handling',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'An async Express/Next.js handler awaits work but contains no try/catch. Rejections may crash or hang the request.',
    recommendation: 'Wrap the body in try/catch and return a proper error response, or use a shared error-handling wrapper.'
  },
  consoleInServer: {
    ...base,
    id: 'quality/console-in-server',
    title: 'Console logging in server code',
    severity: 'low',
    confidence: 'medium',
    kind: 'recommendation',
    description: 'Console statements in server-side code are unstructured and may leak details in production logs.',
    recommendation: 'Use a structured logger with levels and redaction.'
  },
  componentNaming: {
    ...base,
    id: 'quality/component-naming',
    title: 'React component not in PascalCase',
    severity: 'low',
    confidence: 'medium',
    kind: 'recommendation',
    description: 'A function that returns JSX is not named in PascalCase; React treats lowercase JSX tags as DOM elements.',
    recommendation: 'Rename the component using PascalCase.'
  },
  snakeCase: {
    ...base,
    id: 'quality/naming-consistency',
    title: 'Inconsistent identifier naming',
    severity: 'info',
    confidence: 'medium',
    kind: 'recommendation',
    description: 'snake_case identifiers are mixed into JavaScript/TypeScript code that conventionally uses camelCase.',
    recommendation: 'Adopt a consistent naming convention (camelCase for variables/functions, PascalCase for types/components).'
  }
} satisfies Record<string, RuleMeta>;

const MAX_PER_RULE = 15;

type FunctionLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

export function functionName(fn: FunctionLike): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) {
    return fn.name.getText();
  }
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent)) {
    return parent.name.getText();
  }
  if (ts.isConstructorDeclaration(fn)) {
    return 'constructor';
  }
  return '<anonymous>';
}

/** Cyclomatic complexity of a function body, not descending into nested functions. */
export function cyclomaticComplexity(fn: ts.Node): number {
  let complexity = 1;
  const visit = (node: ts.Node) => {
    if (node !== fn && isFunctionLike(node)) {
      return;
    }
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.CaseClause:
        complexity++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
          complexity++;
        }
        break;
      }
    }
    node.forEachChild(visit);
  };
  visit(fn);
  return complexity;
}

const NESTING_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement
]);

/** Deepest control-flow nesting within a function and the node where it occurs. */
export function maxNesting(fn: ts.Node): { depth: number; node: ts.Node | null } {
  let best = { depth: 0, node: null as ts.Node | null };
  const visit = (node: ts.Node, depth: number) => {
    if (node !== fn && isFunctionLike(node)) {
      return;
    }
    let d = depth;
    // `else if` chains do not add nesting.
    const isElseIf = ts.isIfStatement(node) && node.parent && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
    if (NESTING_KINDS.has(node.kind) && !isElseIf) {
      d = depth + 1;
      if (d > best.depth) {
        best = { depth: d, node };
      }
    }
    node.forEachChild((c) => visit(c, d));
  };
  visit(fn, 0);
  return best;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found || (n !== node && isFunctionLike(n))) {
      return;
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

function isAwaitedOrReturned(node: ts.Node): boolean {
  let cur: ts.Node = node;
  while (cur.parent && (ts.isPropertyAccessExpression(cur.parent) || ts.isCallExpression(cur.parent) || ts.isParenthesizedExpression(cur.parent))) {
    cur = cur.parent;
  }
  const p = cur.parent;
  return !!p && (ts.isAwaitExpression(p) || ts.isReturnStatement(p) || ts.isVariableDeclaration(p) || ts.isArrowFunction(p) || ts.isBinaryExpression(p) || ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isCallExpression(p));
}

function containsTry(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) {
      return;
    }
    if (ts.isTryStatement(n) || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'catch')) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

function containsAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found || (n !== node && isFunctionLike(n))) {
      return;
    }
    if (ts.isAwaitExpression(n)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

const ROUTE_METHOD = /^(get|post|put|patch|delete|all|use)$/;
const NEXT_HANDLER = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;

export interface FunctionMetrics {
  count: number;
}

export function analyzeQualityAst(ctx: FileContext): { findings: Finding[]; functionCount: number } {
  const sf = ctx.sourceFile;
  if (!sf) {
    return { findings: [], functionCount: 0 };
  }
  const findings: Finding[] = [];
  const perRule = new Map<string, number>();
  const isTs = /\.[cm]?tsx?$/.test(ctx.file.relPath);
  let functionCount = 0;
  const add = (rule: RuleMeta, node: ts.Node, overrides: Partial<Finding> = {}) => {
    const n = perRule.get(rule.id) ?? 0;
    if (n >= MAX_PER_RULE) {
      return;
    }
    perRule.set(rule.id, n + 1);
    findings.push(findingAt(ctx, rule, lineOf(sf, node), overrides));
  };

  // Comment-based suppressions
  ctx.lines.forEach((line, i) => {
    const m = /\/\/\s*@ts-(ignore|nocheck)\b|\/\*\s*@ts-(ignore|nocheck)\b/.exec(line);
    if (m) {
      findings.push(findingAt(ctx, QUALITY_RULES.tsIgnore, { line: i + 1, column: m.index + 1 }));
    }
  });

  if (ctx.lines.length > QUALITY_THRESHOLDS.fileLines && !ctx.roles.isTest) {
    findings.push(findingAt(ctx, QUALITY_RULES.largeFile, { line: 1 }, { description: `The file has ${ctx.lines.length} lines (threshold ${QUALITY_THRESHOLDS.fileLines}).` }));
  }

  const snakeNames: { name: string; node: ts.Node }[] = [];

  walk(sf, (node) => {
    if (isTs) {
      if (node.kind === ts.SyntaxKind.AnyKeyword && !ctx.roles.isTest) {
        const parent = node.parent;
        if (!(parent && ts.isAsExpression(parent))) {
          add(QUALITY_RULES.explicitAny, node);
        }
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const typeText = node.type.getText(sf);
        const inner = node.expression;
        const doubleAssertion = (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) && /^unknown$|^any$/.test(inner.type.getText(sf));
        if (typeText === 'any' || doubleAssertion) {
          add(QUALITY_RULES.unsafeAssertion, node);
        }
      }
      if (ts.isNonNullExpression(node) && !ctx.roles.isTest) {
        add(QUALITY_RULES.nonNullAssertion, node);
      }
    }

    if (ts.isCatchClause(node)) {
      const stmts = node.block.statements;
      const blockText = node.block.getText(sf);
      if (stmts.length === 0 && !/\/\/|\/\*/.test(blockText)) {
        add(QUALITY_RULES.emptyCatch, node);
      } else if (
        stmts.length === 1 &&
        ts.isExpressionStatement(stmts[0]) &&
        /^console\.(log|error|warn)\(/.test(stmts[0].getText(sf)) &&
        ctx.roles.isServer
      ) {
        add(QUALITY_RULES.catchOnlyLogs, node);
      }
    }

    if (isFunctionLike(node) && node.body) {
      functionCount++;
      const name = functionName(node);
      const complexity = cyclomaticComplexity(node);
      if (complexity > QUALITY_THRESHOLDS.complexity) {
        add(QUALITY_RULES.complexFunction, node.name ?? node, {
          description: `\`${name}\` has a cyclomatic complexity of ${complexity} (threshold ${QUALITY_THRESHOLDS.complexity}).`
        });
      }
      const loc = lineOf(sf, node.body);
      const length = loc.endLine - loc.line + 1;
      if (length > QUALITY_THRESHOLDS.functionLines && !ctx.roles.isTest) {
        add(QUALITY_RULES.longFunction, node.name ?? node, {
          description: `\`${name}\` spans ${length} lines (threshold ${QUALITY_THRESHOLDS.functionLines}).`
        });
      }
      const nesting = maxNesting(node);
      if (nesting.depth > QUALITY_THRESHOLDS.nesting && nesting.node) {
        add(QUALITY_RULES.deepNesting, nesting.node, {
          description: `\`${name}\` nests control flow ${nesting.depth} levels deep (threshold ${QUALITY_THRESHOLDS.nesting}).`
        });
      }
      if (node.parameters.length > QUALITY_THRESHOLDS.parameters) {
        add(QUALITY_RULES.tooManyParams, node.name ?? node, {
          description: `\`${name}\` declares ${node.parameters.length} parameters.`
        });
      }
      if (/\.(jsx|tsx)$/.test(ctx.file.relPath) && /^[a-z]/.test(name) && name !== '<anonymous>' && ts.isFunctionDeclaration(node) && containsJsx(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        // Only exported top-level functions returning JSX are reliably components (render helpers are common).
        if (!/^(render|get|use|create|make|build|with)/.test(name)) {
          add(QUALITY_RULES.componentNaming, node.name ?? node);
        }
      }

      // Async handlers without error handling
      const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isAsync && containsAwait(node) && !containsTry(node.body)) {
        const isNextHandler = ctx.roles.isNextApiRoute && ts.isFunctionDeclaration(node) && NEXT_HANDLER.test(name);
        const parentCall = node.parent && ts.isCallExpression(node.parent) ? node.parent : undefined;
        const isExpressHandler =
          !!parentCall &&
          ts.isPropertyAccessExpression(parentCall.expression) &&
          ROUTE_METHOD.test(parentCall.expression.name.text) &&
          /^(app|router|api|server|r|routes?)$/i.test(parentCall.expression.expression.getText(sf)) &&
          parentCall.arguments[parentCall.arguments.length - 1] === node;
        if (isNextHandler || isExpressHandler) {
          add(QUALITY_RULES.asyncRouteNoTry, node.name ?? node);
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'then') {
        // Inspect the outermost call of the chain.
        let outer: ts.Node = node;
        while (outer.parent && ts.isPropertyAccessExpression(outer.parent) && outer.parent.parent && ts.isCallExpression(outer.parent.parent)) {
          outer = outer.parent.parent;
        }
        // A chain used as a bare statement is neither awaited nor returned.
        const floating = ts.isExpressionStatement(outer.parent) && !isAwaitedOrReturned(outer);
        if (floating && node.arguments.length < 2 && !/\.catch\(/.test(outer.getText(sf))) {
          add(QUALITY_RULES.unhandledPromise, node);
        }
      }
      if (/^console$/.test(node.expression.expression.getText(sf)) && /^(log|debug|info)$/.test(method) && ctx.roles.isServer && !ctx.roles.isTest) {
        add(QUALITY_RULES.consoleInServer, node);
      }
    }

    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      const n = node.name.text;
      if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)) {
        snakeNames.push({ name: n, node: node.name });
      }
    }
  });

  if (snakeNames.length >= 3) {
    add(QUALITY_RULES.snakeCase, snakeNames[0].node, {
      description: `${snakeNames.length} snake_case identifiers were declared in this file (e.g. ${snakeNames
        .slice(0, 3)
        .map((s) => `\`${s.name}\``)
        .join(', ')}).`
    });
  }

  return { findings, functionCount };
}
