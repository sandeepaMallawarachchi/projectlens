import { describe, expect, it } from 'vitest';
import { scanFixture } from './helpers';
import { parseLockfile, parsePackageJson, parseTsconfigStrict } from '../../src/analyzers/technology/manifests';
import { packageNameFromSpecifier } from '../../src/analyzers/progress/facts';

describe('technology detection', () => {
  it('detects the Next.js stack with evidence and versions', async () => {
    const r = await scanFixture('healthy-nextjs', 'quick');
    const tech = Object.fromEntries(r.technology.technologies.map((t) => [t.id, t]));
    expect(r.technology.primaryFramework).toBe('Next.js');
    expect(tech.nextjs.usage).toBe('used');
    expect(tech.nextjs.resolvedVersion).toBe('15.2.4');
    expect(tech.react.usage).toBe('used');
    expect(tech.prisma.usage).toBe('used');
    expect(tech.nextauth.usage).toBe('used');
    expect(tech.zod.confidence).toBe('high');
    expect(tech.tailwind.usage).toBe('configured');
    expect(tech.postgresql).toBeDefined();
    expect(tech['github-actions']).toBeDefined();
    expect(r.technology.packageManager).toBe('npm');
    expect(tech.nextjs.evidence.some((e) => e.kind === 'import')).toBe(true);
  });

  it('does not claim usage for dependencies that are never imported', async () => {
    const r = await scanFixture('partial-saas', 'quick');
    const stripe = r.technology.technologies.find((t) => t.id === 'stripe');
    expect(stripe?.usage).toBe('declared');
    expect(stripe?.confidence).toBe('low');
  });

  it('detects Express, MySQL and JWT usage in a Node.js project', async () => {
    const r = await scanFixture('vulnerable-app');
    const ids = r.technology.technologies.filter((t) => t.usage === 'used').map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['express', 'mysql', 'jwt']));
    expect(r.technology.primaryFramework).toBe('Express');
  });

  it('parses manifests, lockfiles and JSONC tsconfig', () => {
    expect(parsePackageJson('{"dependencies":{"a":"^1"},"devDependencies":{"b":"2"},"scripts":{"t":"x"}}')).toMatchObject({ dependencies: { a: '^1' }, devDependencies: { b: '2' } });
    expect(parsePackageJson('{ invalid')).toBeNull();
    const npm = parseLockfile('package-lock.json', JSON.stringify({ packages: { 'node_modules/react': { version: '18.3.1' }, 'node_modules/a/node_modules/react': { version: '17.0.0' } } }));
    expect(npm.get('react')).toBe('18.3.1');
    const yarn = parseLockfile('yarn.lock', '"react@^18.2.0":\n  version "18.2.0"\n');
    expect(yarn.get('react')).toBe('18.2.0');
    const pnpm = parseLockfile('pnpm-lock.yaml', "packages:\n  /react@18.2.0:\n    resolution: {}\n  '@scope/pkg@1.2.3':\n");
    expect(pnpm.get('react')).toBe('18.2.0');
    expect(pnpm.get('@scope/pkg')).toBe('1.2.3');
    expect(parseTsconfigStrict('{ // c\n "compilerOptions": { "strict": true, },\n}')).toEqual({ strict: true, parsed: true });
  });

  it('normalizes import specifiers to package names', () => {
    expect(packageNameFromSpecifier('next/link')).toBe('next');
    expect(packageNameFromSpecifier('@prisma/client/runtime')).toBe('@prisma/client');
    expect(packageNameFromSpecifier('./local')).toBeNull();
    expect(packageNameFromSpecifier('@/components/x')).toBeNull();
    expect(packageNameFromSpecifier('node:fs')).toBeNull();
  });
});
