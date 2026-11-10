import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { ScanResult } from '../../src/models/types';

/**
 * Runs inside the VS Code Extension Development Host against tests/fixtures/vulnerable-app
 * (configured in .vscode-test.mjs). No network access or API key is required.
 */
suite('ProjectLens extension', () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('projectlens-dev.projectlens');
    assert.ok(ext, 'extension is installed');
    await ext.activate();
  });

  test('registers all commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'projectlens.quickScan',
      'projectlens.fullScan',
      'projectlens.aiDeepReview',
      'projectlens.openDashboard',
      'projectlens.setGroqApiKey',
      'projectlens.testGroqConnection',
      'projectlens.removeGroqApiKey',
      'projectlens.exportJson',
      'projectlens.exportMarkdown',
      'projectlens.clearScanHistory'
    ]) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }
  });

  test('quick scan detects the stack without an API key', async () => {
    const result = (await vscode.commands.executeCommand('projectlens.quickScan')) as ScanResult | null;
    assert.ok(result, 'scan returned a result');
    assert.strictEqual(result.mode, 'quick');
    assert.strictEqual(result.technology.primaryFramework, 'Express');
    assert.strictEqual(result.scores.quality.score, null, 'quality is not assessed in quick mode');
  });

  test('full scan reports findings and publishes diagnostics', async () => {
    const result = (await vscode.commands.executeCommand('projectlens.fullScan')) as ScanResult | null;
    assert.ok(result);
    assert.ok(result.findings.some((f) => f.ruleId === 'sec/sql-injection'));
    const diagnostics = vscode.languages.getDiagnostics().flatMap(([, list]) => list).filter((d) => d.source === 'ProjectLens');
    assert.ok(diagnostics.length > 0, 'diagnostics were published to the Problems panel');
  });

  test('opens the dashboard webview', async () => {
    await vscode.commands.executeCommand('projectlens.openDashboard', 'security');
    const isDashboard = (t: vscode.Tab) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('projectlens.dashboard');
    let found = false;
    for (let i = 0; i < 40 && !found; i++) {
      found = vscode.window.tabGroups.all.flatMap((g) => g.tabs).some(isDashboard);
      if (!found) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const labels = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => `${t.label}:${t.input instanceof vscode.TabInputWebview ? t.input.viewType : typeof t.input}`);
    assert.ok(found, `dashboard tab is open (tabs: ${labels.join(', ')})`);
  });
});
