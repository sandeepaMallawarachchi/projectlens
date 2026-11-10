import type * as vscode from 'vscode';
import type { ProjectLensController } from '../controller';
import { renderWebviewHtml, webviewOptions } from './webviewHtml';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'projectlens.sidebar';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ProjectLensController
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'sidebar');
    const registration = this.controller.register(view.webview);
    const listener = view.webview.onDidReceiveMessage((msg) => this.controller.handleMessage(msg));
    view.onDidDispose(() => {
      registration.dispose();
      listener.dispose();
    });
  }
}
