import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'dist/test/integration/**/*.test.js',
  workspaceFolder: './tests/fixtures/vulnerable-app',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  mocha: { ui: 'tdd', timeout: 60000 }
});
