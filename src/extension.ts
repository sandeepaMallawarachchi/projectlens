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
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context.extensionUri, c, () => openDashboard()), {
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('projectlens.quickScan', () => c.runScan('quick')),
    vscode.commands.registerCommand('projectlens.fullScan', () => c.runScan('full')),
    vscode.commands.registerCommand('projectlens.cancelScan', () => c.cancelScan()),
    vscode.commands.registerCommand('projectlens.aiDeepReview', () => c.runAI('projectAssessment')),
    vscode.commands.registerCommand('projectlens.reviewCurrentFile', () => c.reviewActiveFile()),
    vscode.commands.registerCommand('projectlens.openDashboard', (tab?: string) => openDashboard(typeof tab === 'string' ? tab : undefined)),
    vscode.commands.registerCommand('projectlens.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:SandeepaMallawarachchi.projectlens')),
    vscode.commands.registerCommand('projectlens.setApiKey', () => c.setApiKey()),
    vscode.commands.registerCommand('projectlens.selectProvider', () => c.selectProvider()),
    vscode.commands.registerCommand('projectlens.testConnection', () => c.testConnection()),
    vscode.commands.registerCommand('projectlens.removeApiKey', () => c.removeApiKey()),
    vscode.commands.registerCommand('projectlens.selectModel', () => c.listModels(true)),
    // Aliases for the original Groq-only command IDs (not shown in the palette).
    vscode.commands.registerCommand('projectlens.setGroqApiKey', () => c.setApiKey('groq')),
    vscode.commands.registerCommand('projectlens.testGroqConnection', () => c.testConnection()),
    vscode.commands.registerCommand('projectlens.removeGroqApiKey', () => c.removeApiKey('groq')),
    vscode.commands.registerCommand('projectlens.selectGroqModel', () => c.listModels(true)),
    vscode.commands.registerCommand('projectlens.exportJson', () => c.exportReport('json')),
    vscode.commands.registerCommand('projectlens.exportMarkdown', () => c.exportReport('markdown')),
    vscode.commands.registerCommand('projectlens.clearScanHistory', () => c.clearHistory()),
    vscode.commands.registerCommand('projectlens.createRequirementsFile', () => c.createRequirementsFile()),
    vscode.commands.registerCommand('projectlens.cloudSignIn', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Sign in with GitHub', method: 'github' as const },
          { label: 'Sign in with email', method: 'email' as const }
        ],
        { title: 'ProjectLens Cloud' }
      );
      if (pick) {
        await c.cloud.signIn(pick.method);
      }
    }),
    vscode.commands.registerCommand('projectlens.cloudSignOut', () => c.cloud.signOut()),
    vscode.commands.registerCommand('projectlens.cloudLinkWorkspace', () => c.cloud.linkWorkspace()),
    vscode.commands.registerCommand('projectlens.cloudUpload', () => c.cloud.upload()),
    vscode.commands.registerCommand('projectlens.cloudScan', () => c.cloud.cloudScan()),
    vscode.commands.registerCommand('projectlens.cloudOpen', () => openDashboard('cloud')),
    vscode.commands.registerCommand('projectlens.promptGuard.menu', () => c.promptGuard.menu()),
    vscode.commands.registerCommand('projectlens.promptGuard.review', () => c.promptGuard.review('manual')),
    vscode.commands.registerCommand('projectlens.promptGuard.chooseTools', () => c.promptGuard.chooseAndInstall()),
    vscode.commands.registerCommand('projectlens.promptGuard.sanitize', () => c.promptGuard.sanitizeText()),
    vscode.commands.registerCommand('projectlens.promptGuard.copySanitized', () => c.promptGuard.copySanitized())
  );

  await c.init();
  return { controller: c };
}

export function deactivate(): void {
  controller = undefined;
}
