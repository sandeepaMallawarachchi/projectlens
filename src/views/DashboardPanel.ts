import * as vscode from 'vscode';
import type { ProjectLensController } from '../controller';
import { renderWebviewHtml, webviewOptions } from './webviewHtml';

const TABS = new Set(['overview', 'technologies', 'progress', 'quality', 'security', 'ai', 'cloud', 'reports']);

/** Full editor-tab dashboard (single instance). */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri, controller: ProjectLensController, tab?: string): void {
    const safeTab = tab && TABS.has(tab) ? tab : undefined;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Active);
      if (safeTab) {
        void DashboardPanel.current.panel.webview.postMessage({ type: 'navigate', tab: safeTab });
      }
      return;
    }
    const panel = vscode.window.createWebviewPanel('projectlens.dashboard', 'ProjectLens', vscode.ViewColumn.Active, {
      ...webviewOptions(extensionUri),
      retainContextWhenHidden: true
    });
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'projectlens.svg');
    DashboardPanel.current = new DashboardPanel(panel, extensionUri, controller, safeTab ?? 'overview');
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    controller: ProjectLensController,
    tab: string
  ) {
    panel.webview.html = renderWebviewHtml(panel.webview, extensionUri, 'dashboard', tab);
    this.disposables.push(controller.register(panel.webview));
    this.disposables.push(panel.webview.onDidReceiveMessage((msg) => controller.handleMessage(msg)));
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
