import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['tests/integration/extension.test.ts'],
  bundle: true,
  outfile: 'dist/test/integration/extension.test.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode', 'mocha'],
  logLevel: 'info'
});
