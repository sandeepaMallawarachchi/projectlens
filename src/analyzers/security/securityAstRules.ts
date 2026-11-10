import ts from 'typescript';
import type { Finding } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { lineOf, walk } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';

const base = { category: 'security', analyzer: 'security-ast' } as const;

export const SECURITY_RULES = {
  sqlInjection: {
    ...base,
    id: 'sec/sql-injection',
    title: 'SQL query built from dynamic strings',
    severity: 'high',
    confidence: 'medium',
    description: 'A SQL statement is constructed with string concatenation or template interpolation and passed to a query API.',
    impact: 'If any interpolated value is user-controlled, an attacker can read or modify arbitrary data (SQL injection).',
    recommendation:
      'Use parameterized queries (placeholders such as `$1`/`?`), the ORM query builder, or Prisma tagged `$queryRaw` templates instead of string building.'
  },
  commandInjection: {
    ...base,
    id: 'sec/command-injection',
    title: 'Shell command built from dynamic strings',
    severity: 'high',
    confidence: 'medium',
    description: '`exec`/`execSync` run their argument through a shell, and the command is built dynamically.',
    impact: 'User-controlled input could execute arbitrary commands on the server.',
    recommendation: 'Use `execFile`/`spawn` with an argument array and validate inputs against an allow-list.'
  },
  evalUsage: {
    ...base,
    id: 'sec/eval',
    title: 'Dynamic code evaluation',
    severity: 'high',
    confidence: 'high',
    description: '`eval`, `new Function` or string-based timers execute strings as code.',
    impact: 'Evaluating attacker-influenced strings leads to remote code execution or XSS.',
    recommendation: 'Replace dynamic evaluation with explicit logic, JSON.parse for data, or a lookup table.'
  },
  dangerousHtml: {
    ...base,
    id: 'sec/unsafe-html',
    title: 'Unsanitized HTML rendering',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'HTML is injected into the DOM (`dangerouslySetInnerHTML`, `innerHTML`, `document.write`) without visible sanitization.',
    impact: 'If the HTML contains user-controlled content, attackers can run scripts in other users\' sessions (XSS).',
    recommendation: 'Render text instead of HTML, or sanitize with a maintained library such as DOMPurify before injection.'
  },
  jwtDecode: {
    ...base,
    id: 'sec/jwt-decode-without-verify',
    title: 'JWT decoded without signature verification',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: '`jwt.decode` reads token claims without verifying the signature, and this file never calls `verify`.',
    impact: 'Trusting decoded claims allows forged tokens to impersonate any user.',
    recommendation: 'Use `jwt.verify` (or your auth library\'s verification API) before trusting any claim.'
  },
  jwtHardcodedSecret: {
    ...base,
    id: 'sec/jwt-hardcoded-secret',
    title: 'JWT signed with a hardcoded secret',
    severity: 'high',
    confidence: 'high',
    description: 'A string literal is used as the JWT signing or verification secret.',
    impact: 'Anyone who can read the source can forge valid tokens.',
    recommendation: 'Load a long random secret from the environment or a secret manager; rotate the exposed secret.'
  },
  jwtNoneAlgorithm: {
    ...base,
    id: 'sec/jwt-none-algorithm',
    title: 'JWT "none" algorithm or expiration bypass',
    severity: 'high',
    confidence: 'high',
    description: 'Token verification allows the `none` algorithm or ignores expiration.',
    impact: 'Unsigned or expired tokens may be accepted as valid.',
    recommendation: 'Pin the expected algorithms (e.g. `algorithms: ["HS256"]`) and never set `ignoreExpiration: true`.'
  },
  jwtNoExpiry: {
    ...base,
    id: 'sec/jwt-no-expiry',
    title: 'JWT issued without expiration',
    severity: 'low',
    confidence: 'medium',
    kind: 'recommendation',
    description: '`jwt.sign` is called without an `expiresIn` option.',
    impact: 'Tokens without expiry remain valid indefinitely if leaked.',
    recommendation: 'Set a short `expiresIn` and implement refresh/rotation.'
  },
  tokenInLocalStorage: {
    ...base,
    id: 'sec/token-in-localstorage',
    title: 'Authentication token stored in localStorage',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'A token-like value is persisted to Web Storage, which is readable by any script on the page.',
    impact: 'Any XSS vulnerability can exfiltrate the token and hijack the session.',
    recommendation: 'Prefer `HttpOnly`, `Secure`, `SameSite` cookies for session tokens.'
  },
  insecureCookie: {
    ...base,
    id: 'sec/insecure-cookie',
    title: 'Cookie security flag disabled',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'A cookie is configured with `httpOnly: false` or `secure: false`.',
    impact: 'Session cookies become readable by scripts or are sent over plain HTTP.',
    recommendation: 'Set `httpOnly: true`, `secure: true` in production and an explicit `sameSite` policy.'
  },
  corsWildcard: {
    ...base,
    id: 'sec/cors-permissive',
    title: 'Permissive CORS configuration',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'CORS allows any origin (`*`, `origin: true`, or `cors()` without options).',
    impact: 'Any website can call the API from a victim\'s browser; combined with credentials this exposes user data.',
    recommendation: 'Restrict `origin` to an explicit allow-list of trusted domains.'
  },
  corsCredentials: {
    ...base,
    id: 'sec/cors-credentials-any-origin',
    title: 'CORS reflects any origin with credentials',
    severity: 'high',
    confidence: 'high',
    description: 'CORS is configured with `credentials: true` and an unrestricted origin.',
    impact: 'Malicious sites can make authenticated requests and read responses on behalf of logged-in users.',
    recommendation: 'Use an explicit origin allow-list when credentials are enabled.'
  },
  tlsDisabled: {
    ...base,
    id: 'sec/tls-verification-disabled',
    title: 'TLS certificate verification disabled',
    severity: 'high',
    confidence: 'high',
    description: '`rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0` disables certificate validation.',
    impact: 'Connections become vulnerable to man-in-the-middle interception.',
    recommendation: 'Remove the override and configure the correct CA bundle instead.'
  },
  weakHash: {
    ...base,
    id: 'sec/weak-hash',
    title: 'Weak hash algorithm',
    severity: 'low',
    confidence: 'medium',
    description: 'MD5 or SHA-1 is used. These are unsuitable for security purposes.',
    impact: 'Collisions and fast brute-force make these hashes unsafe for passwords, signatures or integrity checks.',
    recommendation: 'Use SHA-256+ for integrity, and bcrypt/scrypt/argon2 for passwords.'
  },
  weakPasswordHash: {
    ...base,
    id: 'sec/weak-password-hash',
    title: 'Password hashed with a fast hash',
    severity: 'high',
    confidence: 'medium',
    description: 'A fast hash (MD5/SHA-1/SHA-256) appears to be used in password handling.',
    impact: 'Leaked password hashes can be cracked quickly with commodity hardware.',
    recommendation: 'Use bcrypt, scrypt or argon2 with a per-user salt.'
  },
  insecureRandom: {
    ...base,
    id: 'sec/insecure-random',
    title: 'Math.random used for security-sensitive value',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: '`Math.random()` is used where a token, password, OTP or key appears to be generated.',
    impact: 'Math.random is predictable; generated tokens may be guessable.',
    recommendation: 'Use `crypto.randomBytes`, `crypto.randomUUID` or `crypto.getRandomValues`.'
  },
  sensitiveLogging: {
    ...base,
    id: 'sec/sensitive-logging',
    title: 'Sensitive value written to logs',
    severity: 'medium',
    confidence: 'medium',
    description: 'A console call logs a value whose name suggests credentials, tokens or request headers.',
    impact: 'Secrets in logs are exposed to anyone with log access and are often retained for a long time.',
    recommendation: 'Remove the log statement or log a redacted/derived value instead.'
  },
  envDump: {
    ...base,
    id: 'sec/env-dump',
    title: 'Entire process.env exposed',
    severity: 'high',
    confidence: 'high',
    description: 'The whole `process.env` object is logged, serialized or returned.',
    impact: 'All server secrets in the environment can be disclosed.',
    recommendation: 'Expose only the specific non-sensitive values you need.'
  },
  nosqlInjection: {
    ...base,
    id: 'sec/nosql-injection',
    title: 'Request data passed directly into a database query',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'Raw `req.body`/`req.query` values are used as a query filter.',
    impact: 'Attackers can inject query operators (e.g. `{ "$ne": null }`) to bypass filters or authentication.',
    recommendation: 'Validate and coerce input (e.g. with Zod) and build filters from explicit primitive fields.'
  },
  massAssignment: {
    ...base,
    id: 'sec/mass-assignment',
    title: 'Unvalidated request body persisted',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'The request body is passed directly as data to a create/update operation.',
    impact: 'Clients may set fields they should not control (roles, ownership, prices).',
    recommendation: 'Validate the body against a schema and pick allowed fields explicitly.'
  },
  openRedirect: {
    ...base,
    id: 'sec/open-redirect',
    title: 'Redirect target taken from request',
    severity: 'medium',
    confidence: 'medium',
    status: 'needs-review',
    description: 'A redirect uses a URL taken from the request query, body or search params.',
    impact: 'Attackers can craft links that redirect users to phishing sites.',
    recommendation: 'Only allow relative paths or targets from an allow-list.'
  },
  pathTraversal: {
    ...base,
    id: 'sec/path-traversal',
    title: 'File path built from request input',
    severity: 'high',
    confidence: 'medium',
    status: 'needs-review',
    description: 'A filesystem API receives a path derived from request data.',
    impact: 'Attackers may read or write files outside the intended directory using `../` sequences.',
    recommendation: 'Resolve the path, verify it stays inside an allowed base directory, and validate the file name.'
  }
} satisfies Record<string, RuleMeta>;

const SQL_KEYWORDS = /\b(select\s.+\sfrom|insert\s+into|update\s+\w+\s+set|delete\s+from|where\s|drop\s+table|order\s+by|values\s*\()/i;
const SQL_METHODS = new Set(['query', 'execute', 'raw', 'unsafe', '$queryRawUnsafe', '$executeRawUnsafe', 'queryRawUnsafe', 'whereRaw', 'sql', 'exec']);
const USER_INPUT = /\b(req|request|ctx\.request)\.(body|query|params|headers|cookies)|searchParams|formData\(|params\.\w+|event\.body/;
const SENSITIVE_NAME = /(password|passwd|secret|token|api_?key|authorization|credential|private_?key|credit_?card|cardNumber|cvv|ssn)/i;

function calleeText(sf: ts.SourceFile, call: ts.CallExpression): string {
  return call.expression.getText(sf);
}

function lastName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  return '';
}

/** True for template literals with substitutions and `+` concatenations involving non-literals. */
export function isDynamicString(node: ts.Node): boolean {
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.length > 0;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const literalish = (n: ts.Node): boolean =>
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) || (ts.isBinaryExpression(n) && !isDynamicString(n));
    const containsString = (n: ts.Node): boolean =>
      ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && (containsString(n.left) || containsString(n.right)));
    return containsString(node) && !(literalish(node.left) && literalish(node.right));
  }
  if (ts.isParenthesizedExpression(node)) {
    return isDynamicString(node.expression);
  }
  return false;
}

function staticText(node: ts.Node, sf: ts.SourceFile): string {
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ');
  }
  return node.getText(sf);
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  if (!p.name) {
    return undefined;
  }
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) {
    return p.name.text;
  }
  return undefined;
}

function objectProps(obj: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>();
  for (const p of obj.properties) {
    const name = propName(p);
    if (name && ts.isPropertyAssignment(p)) {
      map.set(name, p.initializer);
    }
  }
  return map;
}

function enclosingName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    if ((ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) && cur.name && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    if (ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return cur.left.getText();
    }
    if (ts.isSourceFile(cur)) {
      break;
    }
    cur = cur.parent;
  }
  return '';
}

export function analyzeSecurityAst(ctx: FileContext): Finding[] {
  const sf = ctx.sourceFile;
  if (!sf) {
    return [];
  }
  const findings: Finding[] = [];
  const text = ctx.text;
  const hasVerify = /\.verify\s*\(/.test(text);
  const mentionsPassword = /password|passwd/i.test(text);
  const add = (rule: RuleMeta, node: ts.Node, overrides: Partial<Finding> = {}) =>
    findings.push(findingAt(ctx, rule, lineOf(sf, node), overrides));

  walk(sf, (node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeText(sf, node);
      const name = lastName(node.expression);
      const args = node.arguments;
      const first = args[0];

      // SQL injection
      if (first && SQL_METHODS.has(name)) {
        const unsafeApi = /Unsafe$/.test(name);
        if ((isDynamicString(first) && (unsafeApi || SQL_KEYWORDS.test(staticText(first, sf)))) || (unsafeApi && !ts.isStringLiteral(first))) {
          const userInput = USER_INPUT.test(first.getText(sf));
          add(SECURITY_RULES.sqlInjection, node, userInput ? { status: 'confirmed', confidence: 'high' } : { status: 'needs-review' });
        }
      }

      // Command injection
      if (first && /^(exec|execSync)$/.test(name) && /child_process|exec/.test(text) && isDynamicString(first)) {
        add(SECURITY_RULES.commandInjection, node, USER_INPUT.test(first.getText(sf)) ? { confidence: 'high' } : { status: 'needs-review' });
      }

      // eval / setTimeout(string)
      if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        add(SECURITY_RULES.evalUsage, node);
      }
      if (first && /^(setTimeout|setInterval)$/.test(name) && (ts.isStringLiteral(first) || isDynamicString(first))) {
        add(SECURITY_RULES.evalUsage, node, { confidence: 'medium' });
      }

      // document.write / insertAdjacentHTML
      if (/^document\.(write|writeln)$/.test(callee) || (name === 'insertAdjacentHTML' && args[1] && !ts.isStringLiteral(args[1]))) {
        add(SECURITY_RULES.dangerousHtml, node);
      }

      // JWT
      if (/(^|\.)(jwt|jsonwebtoken|jose)\.decode$/.test(callee) && !hasVerify) {
        add(SECURITY_RULES.jwtDecode, node);
      }
      if (/(^|\.)(jwt|jsonwebtoken)\.(sign|verify)$/.test(callee) && args[1]) {
        if (ts.isStringLiteral(args[1]) || ts.isNoSubstitutionTemplateLiteral(args[1])) {
          add(SECURITY_RULES.jwtHardcodedSecret, node);
        }
        if (name === 'sign') {
          const opts = args[2];
          const hasExpiry =
            (opts && ts.isObjectLiteralExpression(opts) && objectProps(opts).has('expiresIn')) ||
            /\bexp\s*:/.test(args[0]?.getText(sf) ?? '');
          if (!hasExpiry && !(opts && ts.isIdentifier(opts))) {
            add(SECURITY_RULES.jwtNoExpiry, node);
          }
        }
      }

      // Tokens in localStorage
      if (/^(window\.)?(localStorage|sessionStorage)\.setItem$/.test(callee) && first) {
        const key = first.getText(sf);
        if (/token|jwt|auth|session|access|refresh|bearer/i.test(key)) {
          add(SECURITY_RULES.tokenInLocalStorage, node);
        }
      }

      // CORS
      if (ts.isIdentifier(node.expression) && node.expression.text === 'cors' && args.length === 0 && /from\s+['"]cors['"]|require\(['"]cors['"]\)/.test(text)) {
        add(SECURITY_RULES.corsWildcard, node);
      }
      if (/\.(setHeader|header|set|append)$/.test(callee) && first && /^['"`]access-control-allow-origin['"`]$/i.test(first.getText(sf)) && args[1] && /^['"`]\*['"`]$/.test(args[1].getText(sf))) {
        add(SECURITY_RULES.corsWildcard, node);
      }

      // Weak hashing
      if (name === 'createHash' && first && ts.isStringLiteral(first)) {
        const algo = first.text.toLowerCase();
        if (algo === 'md5' || algo === 'sha1') {
          add(mentionsPassword && /password/i.test(enclosingName(node) + node.parent.getText(sf)) ? SECURITY_RULES.weakPasswordHash : SECURITY_RULES.weakHash, node);
        } else if (/^sha(256|512)$/.test(algo) && /password/i.test(enclosingName(node))) {
          add(SECURITY_RULES.weakPasswordHash, node);
        }
      }

      // Insecure randomness
      if (callee === 'Math.random' && /token|secret|password|otp|nonce|salt|session|apikey|api_key|resetcode|verification/i.test(enclosingName(node))) {
        add(SECURITY_RULES.insecureRandom, node);
      }

      // Logging and env dumps
      const isConsole = /^console\.(log|info|debug|warn|error|trace)$/.test(callee);
      for (const arg of args) {
        const argText = arg.getText(sf);
        if (argText === 'process.env' || (ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => ts.isSpreadAssignment(p) && p.expression.getText(sf) === 'process.env'))) {
          add(SECURITY_RULES.envDump, node);
          break;
        }
        if (isConsole && !ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
          const dynamicPart = ts.isTemplateExpression(arg) ? arg.templateSpans.map((s) => s.expression.getText(sf)).join(' ') : argText;
          if (SENSITIVE_NAME.test(dynamicPart) || /\b(req|request)\.headers\b/.test(dynamicPart)) {
            add(SECURITY_RULES.sensitiveLogging, node);
            break;
          }
        }
      }

      // NoSQL injection & mass assignment
      if (/^(find|findOne|findOneAndUpdate|findOneAndDelete|updateOne|updateMany|deleteOne|deleteMany|countDocuments|where)$/.test(name) && first) {
        const t = first.getText(sf);
        if (/^(req|request)\.(body|query)(\.\w+)?$/.test(t) || (ts.isObjectLiteralExpression(first) && first.properties.some((p) => ts.isPropertyAssignment(p) && /^(req|request)\.(body|query)\.\w+$/.test(p.initializer.getText(sf))))) {
          add(SECURITY_RULES.nosqlInjection, node);
        }
      }
      if (/^(create|update|upsert|insertOne|insertMany|createMany|updateMany)$/.test(name) && first) {
        const t = first.getText(sf);
        const passesBody = /^(req|request)\.body$|^body$|^await\s+req(uest)?\.json\(\)$/.test(t);
        const dataBody =
          ts.isObjectLiteralExpression(first) &&
          first.properties.some((p) => ts.isPropertyAssignment(p) && propName(p) === 'data' && /^((req|request)\.body|body|await\s+req(uest)?\.json\(\))$/.test(p.initializer.getText(sf)));
        if (passesBody || dataBody) {
          add(SECURITY_RULES.massAssignment, node);
        }
      }

      // Open redirect
      if (/^(res\.redirect|redirect|NextResponse\.redirect|Response\.redirect)$/.test(callee) && first && USER_INPUT.test(args.map((a) => a.getText(sf)).join(','))) {
        add(SECURITY_RULES.openRedirect, node);
      }

      // Path traversal
      if (/^(fs\.)?(readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync)$|^res\.(sendFile|download)$|^path\.(join|resolve)$/.test(callee) && first && USER_INPUT.test(args.map((a) => a.getText(sf)).join(','))) {
        if (!/^path\./.test(callee) || /readFile|sendFile|createReadStream|writeFile/.test(node.parent.getText(sf))) {
          add(SECURITY_RULES.pathTraversal, node);
        }
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function' && (node.arguments?.length ?? 0) > 0) {
      add(SECURITY_RULES.evalUsage, node);
    }

    // innerHTML / outerHTML assignment
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
      const prop = node.left.name.text;
      if ((prop === 'innerHTML' || prop === 'outerHTML') && !ts.isStringLiteral(node.right) && !ts.isNoSubstitutionTemplateLiteral(node.right)) {
        if (!/sanitize|DOMPurify|escape/i.test(node.right.getText(sf))) {
          add(SECURITY_RULES.dangerousHtml, node);
        }
      }
      if (/process\.env\.NODE_TLS_REJECT_UNAUTHORIZED$/.test(node.left.getText(sf)) && /['"`]0['"`]|^0$/.test(node.right.getText(sf))) {
        add(SECURITY_RULES.tlsDisabled, node);
      }
    }

    // JSX dangerouslySetInnerHTML
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'dangerouslySetInnerHTML') {
      const value = node.initializer?.getText(sf) ?? '';
      if (!/sanitize|DOMPurify|purify|xss\(|marked\.parse.*sanitize/i.test(value) && !/__html:\s*['"`][^'"`$]*['"`]\s*\}/.test(value)) {
        add(SECURITY_RULES.dangerousHtml, node);
      }
    }

    // Object literal configuration checks
    if (ts.isObjectLiteralExpression(node)) {
      const props = objectProps(node);
      const rejectUnauthorized = props.get('rejectUnauthorized');
      if (rejectUnauthorized && rejectUnauthorized.kind === ts.SyntaxKind.FalseKeyword) {
        add(SECURITY_RULES.tlsDisabled, rejectUnauthorized);
      }
      const origin = props.get('origin');
      const credentials = props.get('credentials');
      if (origin && (/^['"`]\*['"`]$/.test(origin.getText(sf)) || origin.kind === ts.SyntaxKind.TrueKeyword)) {
        if (credentials && credentials.kind === ts.SyntaxKind.TrueKeyword) {
          add(SECURITY_RULES.corsCredentials, origin);
        } else if (/cors|Access-Control|credentials|methods|allowedHeaders/i.test(node.getText(sf))) {
          add(SECURITY_RULES.corsWildcard, origin);
        }
      }
      const httpOnly = props.get('httpOnly');
      const secure = props.get('secure');
      if ((httpOnly && httpOnly.kind === ts.SyntaxKind.FalseKeyword) || (secure && secure.kind === ts.SyntaxKind.FalseKeyword && props.has('httpOnly'))) {
        add(SECURITY_RULES.insecureCookie, (httpOnly ?? secure)!);
      }
      const ignoreExpiration = props.get('ignoreExpiration');
      if (ignoreExpiration && ignoreExpiration.kind === ts.SyntaxKind.TrueKeyword) {
        add(SECURITY_RULES.jwtNoneAlgorithm, ignoreExpiration);
      }
      const algorithms = props.get('algorithms') ?? props.get('algorithm');
      if (algorithms && /['"`]none['"`]/i.test(algorithms.getText(sf))) {
        add(SECURITY_RULES.jwtNoneAlgorithm, algorithms);
      }
    }
  });

  return findings;
}
