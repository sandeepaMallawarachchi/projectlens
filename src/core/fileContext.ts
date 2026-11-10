import ts from 'typescript';
import type { DiscoveredFile } from './fileDiscovery';
import { extensionOf, isJsTs } from './languages';

export interface FileRoles {
  isTest: boolean;
  /** Code that runs on a server (API routes, Express handlers, server actions, backend folders). */
  isServer: boolean;
  /** Browser code (`'use client'`, components, Vite/React app source). */
  isClient: boolean;
  isConfig: boolean;
  isNextApiRoute: boolean;
  isNextPage: boolean;
  isFixtureOrExample: boolean;
}

export interface FileContext {
  file: DiscoveredFile;
  text: string;
  lines: string[];
  sourceFile?: ts.SourceFile;
  roles: FileRoles;
}

const TEST_PATH = /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|cypress|playwright)\/|\.(test|spec|e2e)\.[cm]?[jt]sx?$/i;
const SERVER_PATH =
  /(^|\/)(api|server|routes?|controllers?|middlewares?|services?|lib\/server|backend|functions|handlers?|workers?|jobs?|cron)\/|(^|\/)(route|middleware|server|instrumentation)\.[cm]?[jt]s$/i;
const CONFIG_FILE = /(^|\/)[\w.-]+\.config\.[cm]?[jt]s$|(^|\/)\.?[\w-]+rc\.[cm]?js$/i;
const FIXTURE_PATH = /(^|\/)(fixtures?|examples?|samples?|demo|mocks?|__fixtures__|testdata)\//i;

export function computeRoles(relPath: string, text: string): FileRoles {
  const head = text.slice(0, 300);
  const useClient = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(head);
  const useServer = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(head);
  const isNextApiRoute =
    /(^|\/)(src\/)?app\/(.+\/)?route\.[cm]?[jt]s$/.test(relPath) || /(^|\/)(src\/)?pages\/api\//.test(relPath);
  const isNextPage =
    /(^|\/)(src\/)?app\/(.+\/)?page\.[jt]sx?$/.test(relPath) ||
    (/(^|\/)(src\/)?pages\//.test(relPath) && !/(^|\/)pages\/api\//.test(relPath) && /\.[jt]sx?$/.test(relPath));
  const isServer = !useClient && (useServer || isNextApiRoute || SERVER_PATH.test(relPath));
  const isClient =
    useClient || (!isServer && (/\.(jsx|tsx)$/.test(relPath) || /(^|\/)(components|hooks|client)\//.test(relPath)));
  return {
    isTest: TEST_PATH.test(relPath),
    isServer,
    isClient,
    isConfig: CONFIG_FILE.test(relPath),
    isNextApiRoute,
    isNextPage,
    isFixtureOrExample: FIXTURE_PATH.test(relPath)
  };
}

function scriptKind(relPath: string): ts.ScriptKind {
  switch (extensionOf(relPath)) {
    case 'tsx':
      return ts.ScriptKind.TSX;
    case 'jsx':
      return ts.ScriptKind.JSX;
    case 'js':
    case 'mjs':
    case 'cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

export function createFileContext(file: DiscoveredFile, text: string, parse: boolean): FileContext {
  const lines = text.split(/\r?\n/);
  const ctx: FileContext = { file, text, lines, roles: computeRoles(file.relPath, text) };
  if (parse && isJsTs(file.relPath)) {
    // `.js` files may legally contain JSX in React projects; parse them as JSX.
    const kind = scriptKind(file.relPath) === ts.ScriptKind.JS ? ts.ScriptKind.JSX : scriptKind(file.relPath);
    ctx.sourceFile = ts.createSourceFile(file.relPath, text, ts.ScriptTarget.Latest, true, kind);
  }
  return ctx;
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): { line: number; column: number; endLine: number; endColumn: number } {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return { line: start.line + 1, column: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 };
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
