import * as vscode from 'vscode';
import type { ProjectLensController } from '../controller';
import { renderWebviewHtml, webviewOptions } from './webviewHtml';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'projectlens.sidebar';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ProjectLensController,
    /** Called when the user opens the ProjectLens view from the Activity Bar. */
    private readonly onOpened: () => void
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'sidebar');
    const registration = this.controller.register(view.webview);
    const listener = view.webview.onDidReceiveMessage((msg) => this.controller.handleMessage(msg));

    // resolveWebviewView runs the first time the view is shown; later clicks fire visibility changes.
    this.maybeOpenDashboard();
    const visibility = view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.maybeOpenDashboard();
      }
    });

    view.onDidDispose(() => {
      registration.dispose();
      listener.dispose();
      visibility.dispose();
    });
  }

  private maybeOpenDashboard(): void {
    if (vscode.workspace.getConfiguration('projectlens').get<boolean>('openDashboardOnSidebarOpen', true)) {
      this.onOpened();
    }
  }
}
