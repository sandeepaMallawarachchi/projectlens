import * as vscode from 'vscode';
import { ProjectLensController } from './controller';
import { ScanStore } from './storage/scanStore';
import { SidebarProvider } from './views/SidebarProvider';
import { DashboardPanel } from './views/DashboardPanel';

let controller: ProjectLensController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<{ controller: ProjectLensController }> {
  const store = new ScanStore(context);
  await store.init();
  controller = new ProjectLensController(context, store);
  const c = controller;
  context.subscriptions.push(c);

  const openDashboard = (tab?: string) => DashboardPanel.show(context.extensionUri, c, tab);
  c.setDashboardOpener(openDashboard);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context.extensionUri, c), {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('projectlens.quickScan', () => c.runScan('quick')),
    vscode.commands.registerCommand('projectlens.fullScan', () => c.runScan('full')),
    vscode.commands.registerCommand('projectlens.cancelScan', () => c.cancelScan()),
    vscode.commands.registerCommand('projectlens.aiDeepReview', () => c.runAI('projectAssessment')),
    vscode.commands.registerCommand('projectlens.reviewCurrentFile', () => c.reviewActiveFile()),
    vscode.commands.registerCommand('projectlens.openDashboard', (tab?: string) => openDashboard(typeof tab === 'string' ? tab : undefined)),
    vscode.commands.registerCommand('projectlens.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:projectlens-dev.projectlens')),
    vscode.commands.registerCommand('projectlens.setGroqApiKey', () => c.setApiKey()),
    vscode.commands.registerCommand('projectlens.testGroqConnection', () => c.testConnection()),
    vscode.commands.registerCommand('projectlens.removeGroqApiKey', () => c.removeApiKey()),
    vscode.commands.registerCommand('projectlens.selectGroqModel', () => c.listModels(true)),
    vscode.commands.registerCommand('projectlens.exportJson', () => c.exportReport('json')),
    vscode.commands.registerCommand('projectlens.exportMarkdown', () => c.exportReport('markdown')),
    vscode.commands.registerCommand('projectlens.clearScanHistory', () => c.clearHistory()),
    vscode.commands.registerCommand('projectlens.createRequirementsFile', () => c.createRequirementsFile())
  );

  await c.init();
  return { controller: c };
}

export function deactivate(): void {
  controller = undefined;
}
