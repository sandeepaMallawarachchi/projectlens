import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
  keepNames: true,
  // Shipped as runtime dependencies (they rely on dynamic requires).
  external: ['vscode', 'typescript', 'eslint', 'typescript-eslint'],
  logLevel: 'info'
};

/** Standalone Prompt Guard hook, run by AI coding tools with plain Node (no VS Code APIs). */
const hookOptions = {
  ...options,
  entryPoints: ['src/promptGuard/hook.ts'],
  outfile: 'dist/prompt-guard.js',
  external: [],
  sourcemap: false,
  target: 'node18'
};

if (watch) {
  const ctx = await esbuild.context(options);
  const hookCtx = await esbuild.context(hookOptions);
  await Promise.all([ctx.watch(), hookCtx.watch()]);
} else {
  await Promise.all([esbuild.build(options), esbuild.build(hookOptions)]);
}
