import { describe, expect, it } from 'vitest';
import { findSecrets, shannonEntropy } from '../../src/analyzers/security/secretPatterns';
import { analyzeSecrets } from '../../src/analyzers/security/secretsAnalyzer';
import { analyzeSecurityAst } from '../../src/analyzers/security/securityAstRules';
import { analyzeEnvironment, isRealSecretValue } from '../../src/analyzers/security/environmentAnalyzer';
import { analyzeConfigFiles } from '../../src/analyzers/security/configAnalyzer';
import { mapGitleaksReport } from '../../src/analyzers/security/gitleaksAdapter';
import { ctxFor, DUMMY, scanDir, scanFixture, tempDir } from './helpers';

const ids = (list: { ruleId: string }[]) => list.map((f) => f.ruleId);

describe('secret detection (dummy credentials)', () => {
  it.each([
    ['AWS access key', `const k = "${DUMMY.aws}";`, 'secret/aws-access-key'],
    ['GitHub token', `token: '${DUMMY.github}'`, 'secret/github-token'],
    ['Stripe live key', `STRIPE=${DUMMY.stripeLive}`, 'secret/stripe-live-key'],
    ['Groq key', `const groq = new Groq({ apiKey: "${DUMMY.groq}" })`, 'secret/groq-key'],
    ['private key', DUMMY.privateKeyHeader, 'secret/private-key'],
    ['connection string', `const url = "postgres://app:${DUMMY.genericPassword}@db:5432/x"`, 'secret/connection-string'],
    ['generic credential', `const dbPassword = "${DUMMY.genericPassword}";`, 'secret/generic-assignment']
  ])('detects %s', (_label, line, ruleId) => {
    expect(findSecrets(line).map((m) => m.pattern.id)).toContain(ruleId);
  });

  it.each([
    ['env reference', 'const apiKey = process.env.API_KEY;'],
    ['placeholder', 'const apiKey = "your-api-key-here";'],
    ['changeme', 'password: "changeme123"'],
    ['repeated chars', 'const secret = "xxxxxxxxxxxxxxxx";'],
    ['type annotation', 'password: string;'],
    ['empty value', 'const password = "";'],
    ['low entropy', 'const password = "aaaaaaabbbbbbb";'],
    ['AWS documentation example', 'AKIAIOSFODNN7EXAMPLE'],
    ['template interpolation', 'const token = `${prefix}-${id}`;'],
    ['URL without credentials', 'const url = "postgres://localhost:5432/app";'],
    ['camelCase reference', 'const secret = "configSecretName";']
  ])('does not flag %s', (_label, line) => {
    expect(findSecrets(line)).toHaveLength(0);
  });

  it('never includes the full secret in findings', () => {
    const findings = analyzeSecrets(ctxFor('src/config.ts', `export const groqKey = "${DUMMY.groq}";\n`));
    expect(findings).toHaveLength(1);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain(DUMMY.groq);
    expect(findings[0].evidence).toMatch(/gsk_•+/);
    expect(findings[0].severity).toBe('critical');
  });

  it('lowers confidence for test and fixture files', () => {
    const [f] = analyzeSecrets(ctxFor('tests/fixtures/x.ts', `const k = "${DUMMY.aws}";`));
    expect(f.confidence).toBe('low');
    expect(f.tags).toContain('test-or-fixture');
  });

  it('computes Shannon entropy', () => {
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBe(2);
  });

  it('scans a workspace with a committed private key file and dummy credentials', async () => {
    const dir = await tempDir({
      '.gitignore': 'node_modules\n',
      'keys/server.pem': `${DUMMY.privateKeyHeader}\nMIIEFAKEFAKEFAKE\n-----END RSA PRIVATE KEY-----\n`,
      'src/aws.ts': `export const accessKeyId = "${DUMMY.aws}";\n`
    });
    const r = await scanDir(dir);
    expect(ids(r.findings)).toEqual(expect.arrayContaining(['secret/private-key', 'secret/aws-access-key']));
    expect(r.findings.some((f) => f.ruleId === 'secret/credential-file' || f.ruleId === 'secret/private-key')).toBe(true);
    expect(JSON.stringify(r)).not.toContain(DUMMY.aws);
    expect(r.scores.security.caps.join(' ')).toMatch(/capped at 40/);
    expect(r.scores.security.score).toBeLessThanOrEqual(40);
  });
});

describe('environment rules', () => {
  it('flags secrets behind public prefixes and tracked env files', () => {
    const findings = analyzeEnvironment(ctxFor('.env', 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE=abc\nDB_PASSWORD=Qz8vT2mLx9Rk4Wp7\nPORT=3000\n'), { trackedEnv: true });
    expect(ids(findings)).toEqual(['env/public-secret', 'env/tracked-env-secret']);
    expect(JSON.stringify(findings)).not.toContain('Qz8vT2mLx9Rk4Wp7');
  });

  it('flags public-prefixed secret names referenced in code', () => {
    const findings = analyzeEnvironment(ctxFor('app/page.tsx', 'const k = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;'), { trackedEnv: false });
    expect(ids(findings)).toEqual(['env/public-secret']);
  });

  it('treats placeholder URLs in env templates as safe', () => {
    expect(isRealSecretValue('postgresql://user:password@localhost:5432/app')).toBe(false);
    expect(isRealSecretValue('postgresql://localhost:5432/app')).toBe(false);
    expect(isRealSecretValue('postgresql://app:Wk3Rm9Tq2LxZ@db/app')).toBe(true);
    expect(analyzeEnvironment(ctxFor('.env.example', 'DATABASE_URL=postgresql://user:password@localhost/app\nAPI_KEY=your-key-here\n'), { trackedEnv: false })).toHaveLength(0);
  });
});

describe('AST security rules', () => {
  const run = (file: string, code: string) => ids(analyzeSecurityAst(ctxFor(file, code)));

  it('detects SQL injection but not parameterized queries', () => {
    expect(run('src/db.ts', 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);')).toContain('sec/sql-injection');
    expect(run('src/db.ts', 'db.query("SELECT * FROM users WHERE name = \'" + name + "\'");')).toContain('sec/sql-injection');
    expect(run('src/db.ts', 'db.query("SELECT * FROM users WHERE id = $1", [id]);')).not.toContain('sec/sql-injection');
    expect(run('src/db.ts', 'prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;')).not.toContain('sec/sql-injection');
    expect(run('src/db.ts', 'prisma.$queryRawUnsafe(sql);')).toContain('sec/sql-injection');
  });

  it('marks SQL injection with request input as confirmed', () => {
    const [f] = analyzeSecurityAst(ctxFor('src/db.ts', 'db.query(`SELECT * FROM t WHERE id = ${req.query.id}`);'));
    expect(f.status).toBe('confirmed');
    const [g] = analyzeSecurityAst(ctxFor('src/db.ts', 'db.query(`SELECT * FROM t WHERE id = ${id}`);'));
    expect(g.status).toBe('needs-review');
  });

  it('detects unsafe HTML unless sanitized', () => {
    expect(run('a.tsx', 'const A = () => <div dangerouslySetInnerHTML={{ __html: html }} />;')).toContain('sec/unsafe-html');
    expect(run('a.tsx', 'const A = () => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;')).not.toContain('sec/unsafe-html');
    expect(run('a.ts', 'el.innerHTML = input;')).toContain('sec/unsafe-html');
    expect(run('a.ts', 'el.innerHTML = "<b>static</b>";')).not.toContain('sec/unsafe-html');
  });

  it('detects JWT, CORS, TLS, logging and eval issues', () => {
    expect(run('a.ts', 'jwt.sign(payload, "hardcoded-secret");')).toEqual(expect.arrayContaining(['sec/jwt-hardcoded-secret', 'sec/jwt-no-expiry']));
    expect(run('a.ts', 'jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });')).toHaveLength(0);
    expect(run('a.ts', 'const c = jwt.decode(token);')).toContain('sec/jwt-decode-without-verify');
    expect(run('a.ts', 'app.use(cors({ origin: "*", credentials: true }));')).toContain('sec/cors-credentials-any-origin');
    expect(run('a.ts', 'https.request({ rejectUnauthorized: false });')).toContain('sec/tls-verification-disabled');
    expect(run('a.ts', 'console.log("user", user.password);')).toContain('sec/sensitive-logging');
    expect(run('a.ts', 'console.error("Invalid password");')).not.toContain('sec/sensitive-logging');
    expect(run('a.ts', 'eval(code);')).toContain('sec/eval');
    expect(run('a.ts', 'res.json(process.env);')).toContain('sec/env-dump');
    expect(run('a.ts', 'localStorage.setItem("accessToken", t);')).toContain('sec/token-in-localstorage');
    expect(run('a.ts', 'const resetToken = Math.random().toString(36);')).toContain('sec/insecure-random');
    expect(run('a.ts', 'const id = Math.random();')).not.toContain('sec/insecure-random');
  });

  it('applies Next.js/Docker configuration rules', () => {
    expect(ids(analyzeConfigFiles(ctxFor('next.config.mjs', 'export default { typescript: { ignoreBuildErrors: true } }')))).toContain('config/next-ignore-type-errors');
    expect(ids(analyzeConfigFiles(ctxFor('Dockerfile', 'FROM node:latest\nENV API_KEY=abcd1234\n')))).toEqual(expect.arrayContaining(['config/docker-secret-in-image', 'config/docker-unpinned-base', 'config/docker-runs-as-root']));
    expect(ids(analyzeConfigFiles(ctxFor('Dockerfile', 'FROM node:20-alpine\nUSER node\n')))).toHaveLength(0);
  });
});

describe('fixture scans', () => {
  it('finds the deliberate issues in the vulnerable app', async () => {
    const r = await scanFixture('vulnerable-app');
    expect(ids(r.findings)).toEqual(
      expect.arrayContaining([
        'env/env-file-not-ignored',
        'env/tracked-env-secret',
        'env/public-secret',
        'secret/connection-string',
        'secret/generic-assignment',
        'sec/sql-injection',
        'sec/command-injection',
        'sec/eval',
        'sec/jwt-hardcoded-secret',
        'sec/jwt-decode-without-verify',
        'sec/cors-credentials-any-origin',
        'sec/env-dump',
        'sec/sensitive-logging',
        'sec/unsafe-html',
        'sec/token-in-localstorage',
        'sec/missing-authorization',
        'sec/express-no-security-headers',
        'dep/known-advisory',
        'dep/unpinned-version',
        'dep/missing-lockfile'
      ])
    );
    for (const f of r.findings) {
      expect(f.location.file).toBeTruthy();
      expect(f.location.line).toBeGreaterThan(0);
      expect(f.location.uri).toMatch(/^file:\/\//);
      expect(f.recommendation).toBeTruthy();
    }
    expect(JSON.stringify(r)).not.toContain('Qz8vT2mLx9Rk4Wp7');
    expect(JSON.stringify(r)).not.toContain('Wk3Rm9Tq2LxZ');
    expect(r.scores.security.verdict).toBe('Critical issues found');
  });

  it('marks authorization omissions as needs-review rather than confirmed', async () => {
    const r = await scanFixture('vulnerable-app');
    const authz = r.findings.filter((f) => f.ruleId === 'sec/missing-authorization');
    expect(authz.length).toBeGreaterThan(0);
    expect(authz.every((f) => f.status === 'needs-review')).toBe(true);
  });

  it('produces no high-severity security findings for the healthy project', async () => {
    const r = await scanFixture('healthy-nextjs');
    const serious = r.findings.filter((f) => (f.category === 'security' || f.category === 'dependency') && ['critical', 'high', 'medium'].includes(f.severity));
    expect(serious).toEqual([]);
    expect(r.scores.security.score).toBe(100);
  });

  it('maps Gitleaks reports to redacted findings', () => {
    const findings = mapGitleaksReport([{ RuleID: 'aws-access-token', Description: 'AWS', File: 'src/a.ts', StartLine: 3, Match: `key = "${DUMMY.aws}"` }], { path: '/repo', name: 'repo' }, false);
    expect(findings[0]).toMatchObject({ ruleId: 'gitleaks/aws-access-token', severity: 'critical', analyzer: 'gitleaks' });
    expect(findings[0].location).toMatchObject({ file: 'src/a.ts', line: 3 });
    expect(findings[0].evidence).not.toContain(DUMMY.aws);
  });
});
