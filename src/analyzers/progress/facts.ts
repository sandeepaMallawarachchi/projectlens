import ts from 'typescript';
import type { PlaceholderLocation } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { lineOf, walk } from '../../core/fileContext';
import { computeDuplicateHashes } from '../quality/duplicates';

export interface RouteFact {
  method: string;
  path: string;
  line: number;
  /** Names of middleware arguments between the path and the final handler. */
  middleware: string[];
}

export interface FileFacts {
  imports: string[];
  expressRoutes: RouteFact[];
  /** Mounted routers / global middleware: `app.use('/prefix', x)` or `app.use(auth)`. */
  useCalls: { path?: string; names: string[]; line: number }[];
  nextHandlers: { method: string; line: number; empty: boolean }[];
  hasAuthSignal: boolean;
  hasDataAccess: boolean;
  fetchTargets: { path: string; line: number }[];
  placeholders: PlaceholderLocation[];
  hasJsx: boolean;
  isClientComponent: boolean;
  isServerAction: boolean;
  serverActionExports: { name: string; line: number }[];
  envVars: string[];
  models: { name: string; line: number }[];
  functionCount: number;
  lineCount: number;
  duplicateHashes: [string, number][];
}

export const AUTH_SIGNAL =
  /\b(getServerSession|getSession|auth\(\)|currentUser\(|getAuth\(|requireAuth|requireUser|isAuthenticated|ensureAuth\w*|verifyToken|verifyJwt|jwt\.verify|jwtVerify|req\.user|req\.auth|session\??\.user|getToken\(|withAuth|clerkMiddleware|authMiddleware|passport\.authenticate|checkAuth|authorize\w*|authenticate\w*|protect(ed)?Route|requireRole|hasPermission|supabase\.auth\.getUser|getUserFromRequest|validateSession|useSession|unauthorized|401)\b/;
export const AUTH_MIDDLEWARE_NAME = /auth|protect|guard|session|jwt|verify|require(User|Role|Login)|isLoggedIn|ensure|permission|admin/i;

const DATA_ACCESS =
  /\b(prisma\.\w+\.(find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate|groupBy)|\$queryRaw|\.findOne\(|\.findMany\(|\.findById\w*\(|\.find\(\{|\.insertOne\(|\.insertMany\(|\.updateOne\(|\.aggregate\(|mongoose\.model|\.query\(|db\.(select|insert|update|delete)\(|\.collection\(|getDocs?\(|setDoc\(|addDoc\(|\.from\(['"`]\w+['"`]\)\.(select|insert|update|delete|upsert)|knex\(|sequelize\.|\.save\(\)|drizzle\(|sql`)/;

const PLACEHOLDER_ERROR = /not (yet )?implemented|unimplemented|to ?do\b|coming soon|stub/i;
const PLACEHOLDER_TEXT = /lorem ipsum|coming soon|under construction|placeholder (text|content)|not implemented yet|work in progress/i;
const MOCK_NAME = /^(mock|dummy|fake|sample|placeholder|hardcoded|stub)[A-Z_]|(Mock|Dummy|Fake|Stub)(Data|Users?|Items?|Products?|Orders?|Response|Results?|Records?|List)$/;

const FETCH_CALLEES = /^(fetch|axios(\.(get|post|put|patch|delete|request))?|api\.(get|post|put|patch|delete)|http\.(get|post|put|patch|delete)|ky(\.(get|post|put|patch|delete))?|\$fetch|useSWR|useFetch|request|client\.(get|post|put|patch|delete))$/;
const ROUTE_METHODS = /^(get|post|put|patch|delete|all)$/;
const ROUTER_OBJECT = /^(app|router|api|server|r|routes?|\w+Router|\w+Routes)$/;
const NEXT_HANDLER = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;

export function packageNameFromSpecifier(spec: string): string | null {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || /^[~@]\//.test(spec) || spec.startsWith('node:') || /^(https?|data|virtual):/.test(spec)) {
    return null;
  }
  const parts = spec.split('/');
  if (spec.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0];
}

/** Converts a fetch target string/template into a normalized route pattern. */
export function normalizeTarget(node: ts.Expression, sf: ts.SourceFile): string | null {
  let raw: string | null = null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    raw = node.text;
  } else if (ts.isTemplateExpression(node)) {
    raw = node.head.text + node.templateSpans.map((s) => ':param' + s.literal.text).join('');
  } else if (ts.isBinaryExpression(node) && ts.isStringLiteral(node.left)) {
    raw = node.left.text + ':param';
  }
  void sf;
  if (!raw) {
    return null;
  }
  raw = raw.split('?')[0].split('#')[0];
  if (!/^\/?api\//.test(raw)) {
    return null;
  }
  return '/' + raw.replace(/^\//, '').replace(/\/+$/, '').replace(/:param[^/]*/g, ':param');
}

function isEmptyBody(body: ts.ConciseBody | undefined, sf: ts.SourceFile): boolean {
  if (!body || !ts.isBlock(body)) {
    return false;
  }
  return body.statements.length === 0 && !/\/\/|\/\*/.test(body.getText(sf));
}

function isExported(node: ts.Node): boolean {
  return !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function argName(arg: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg)) {
    return arg.getText(sf);
  }
  if (ts.isCallExpression(arg)) {
    return arg.expression.getText(sf);
  }
  return ts.isArrowFunction(arg) || ts.isFunctionExpression(arg) ? '<inline>' : arg.getText(sf).slice(0, 40);
}

export function emptyFacts(lineCount: number): FileFacts {
  return {
    imports: [],
    expressRoutes: [],
    useCalls: [],
    nextHandlers: [],
    hasAuthSignal: false,
    hasDataAccess: false,
    fetchTargets: [],
    placeholders: [],
    hasJsx: false,
    isClientComponent: false,
    isServerAction: false,
    serverActionExports: [],
    envVars: [],
    models: [],
    functionCount: 0,
    lineCount,
    duplicateHashes: []
  };
}

/** Extracts structural facts used by technology detection, progress estimation and cross-file rules. */
export function extractFacts(ctx: FileContext, opts: { duplicates: boolean }): FileFacts {
  const facts = emptyFacts(ctx.lines.length);
  const text = ctx.text;
  facts.hasAuthSignal = AUTH_SIGNAL.test(text);
  facts.hasDataAccess = DATA_ACCESS.test(text);

  const envRe = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g;
  const envVars = new Set<string>();
  let em: RegExpExecArray | null;
  while ((em = envRe.exec(text)) !== null) {
    envVars.add(em[1]);
  }
  facts.envVars = [...envVars];

  // Prisma schema models
  if (/\.prisma$/.test(ctx.file.relPath)) {
    ctx.lines.forEach((line, i) => {
      const m = /^\s*model\s+(\w+)\s*\{/.exec(line);
      if (m) {
        facts.models.push({ name: m[1], line: i + 1 });
      }
    });
    return facts;
  }

  const sf = ctx.sourceFile;
  if (!sf) {
    return facts;
  }
  // Duplicate hashes are cached per file, so they are bounded to keep the cache small.
  if (opts.duplicates && !ctx.roles.isTest && ctx.lines.length <= 3000) {
    facts.duplicateHashes = computeDuplicateHashes(ctx.lines);
  }
  facts.isClientComponent = ctx.roles.isClient;
  facts.isServerAction = /^\s*['"]use server['"]/.test(text.slice(0, 200));

  const imports = new Set<string>();
  const placeholder = (kind: PlaceholderLocation['kind'], detail: string, node: ts.Node) =>
    facts.placeholders.push({ kind, detail, file: ctx.file.displayPath, uri: ctx.file.uri, line: lineOf(sf, node).line });

  walk(sf, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const pkg = packageNameFromSpecifier(node.moduleSpecifier.text);
      if (pkg && !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) {
        imports.add(pkg);
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const first = node.arguments[0];
      if ((callee === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) && first && ts.isStringLiteral(first)) {
        const pkg = packageNameFromSpecifier(first.text);
        if (pkg) {
          imports.add(pkg);
        }
      }
      if (first && FETCH_CALLEES.test(callee)) {
        const target = normalizeTarget(first, sf);
        if (target) {
          facts.fetchTargets.push({ path: target, line: lineOf(sf, node).line });
        }
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const object = node.expression.expression.getText(sf);
        const handlers = node.arguments.slice(1);
        const lastArg = handlers[handlers.length - 1];
        // Requires a handler argument so HTTP client calls like `api.get('/users', { params })` are not mistaken for routes.
        const looksLikeHandler = !!lastArg && !ts.isObjectLiteralExpression(lastArg) && !ts.isStringLiteral(lastArg);
        if (ROUTE_METHODS.test(method) && ROUTER_OBJECT.test(object) && first && ts.isStringLiteral(first) && first.text.startsWith('/') && looksLikeHandler) {
          facts.expressRoutes.push({
            method: method.toUpperCase(),
            path: first.text,
            line: lineOf(sf, node).line,
            middleware: handlers.slice(0, -1).map((a) => argName(a, sf))
          });
          const last = handlers[handlers.length - 1];
          if (last && (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) && isEmptyBody(last.body, sf)) {
            placeholder('empty-function', `Empty handler for ${method.toUpperCase()} ${first.text}`, last);
          }
        }
        if (method === 'use' && ROUTER_OBJECT.test(object)) {
          const pathArg = first && ts.isStringLiteral(first) ? first.text : undefined;
          const rest = pathArg !== undefined ? node.arguments.slice(1) : [...node.arguments];
          facts.useCalls.push({ path: pathArg, names: rest.map((a) => argName(a, sf)), line: lineOf(sf, node).line });
        }
        if (method === 'status' && first && ts.isNumericLiteral(first) && first.text === '501') {
          placeholder('status-501', 'Responds with HTTP 501 Not Implemented', node);
        }
        if (method === 'model' && /mongoose|^model$/.test(object) && first && ts.isStringLiteral(first)) {
          facts.models.push({ name: first.text, line: lineOf(sf, node).line });
        }
        if (/^(define)$/.test(method) && /sequelize/i.test(object) && first && ts.isStringLiteral(first)) {
          facts.models.push({ name: first.text, line: lineOf(sf, node).line });
        }
      }
      if (/^(pgTable|mysqlTable|sqliteTable)$/.test(callee) && first && ts.isStringLiteral(first)) {
        facts.models.push({ name: first.text, line: lineOf(sf, node).line });
      }
      if (callee === 'model' && first && ts.isStringLiteral(first) && /mongoose/.test(text)) {
        facts.models.push({ name: first.text, line: lineOf(sf, node).line });
      }
    }

    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
      const msg = node.expression.arguments?.[0];
      if (msg && (ts.isStringLiteral(msg) || ts.isNoSubstitutionTemplateLiteral(msg)) && PLACEHOLDER_ERROR.test(msg.text)) {
        placeholder('not-implemented', `throws "${msg.text.slice(0, 80)}"`, node);
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'status' && ts.isNumericLiteral(p.initializer) && p.initializer.text === '501') {
          placeholder('status-501', 'Responds with HTTP 501 Not Implemented', p);
        }
      }
    }

    if ((ts.isJsxText(node) || ts.isStringLiteral(node)) && PLACEHOLDER_TEXT.test(node.getText(sf)) && !ctx.roles.isTest) {
      placeholder('placeholder-text', node.getText(sf).trim().slice(0, 80), node);
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      facts.hasJsx = true;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && MOCK_NAME.test(node.name.text) && !ctx.roles.isTest && !ctx.roles.isFixtureOrExample) {
      if (node.initializer && (ts.isArrayLiteralExpression(node.initializer) || ts.isObjectLiteralExpression(node.initializer))) {
        placeholder('mock-data', `Hardcoded data in \`${node.name.text}\``, node);
      }
    }

    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      facts.functionCount++;
    }

    if (ts.isFunctionDeclaration(node) && node.name && isExported(node)) {
      const name = node.name.text;
      const empty = isEmptyBody(node.body, sf);
      if (ctx.roles.isNextApiRoute && NEXT_HANDLER.test(name)) {
        facts.nextHandlers.push({ method: name, line: lineOf(sf, node).line, empty });
      }
      if (facts.isServerAction) {
        facts.serverActionExports.push({ name, line: lineOf(sf, node).line });
      }
      if (empty) {
        placeholder('empty-function', `Exported function \`${name}\` has an empty body`, node);
      }
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) {
          continue;
        }
        const name = decl.name.text;
        const init = decl.initializer;
        const fn = ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init : undefined;
        if (ctx.roles.isNextApiRoute && NEXT_HANDLER.test(name)) {
          facts.nextHandlers.push({ method: name, line: lineOf(sf, decl).line, empty: fn ? isEmptyBody(fn.body, sf) : false });
        }
        if (facts.isServerAction && fn) {
          facts.serverActionExports.push({ name, line: lineOf(sf, decl).line });
        }
        if (fn && isEmptyBody(fn.body, sf)) {
          placeholder('empty-function', `Exported function \`${name}\` has an empty body`, decl);
        }
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
      if (decorators?.some((d) => /^@?Entity\b|^@?Schema\b/.test(d.expression.getText(sf)))) {
        facts.models.push({ name: node.name.text, line: lineOf(sf, node).line });
      }
    }
  });

  facts.imports = [...imports];
  return facts;
}
