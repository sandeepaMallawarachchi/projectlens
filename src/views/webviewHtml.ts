import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function getNonce(): string {
  return randomBytes(16).toString('base64');
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    enableScripts: true,
    enableCommandUris: false,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview'), vscode.Uri.joinPath(extensionUri, 'media')]
  };
}

/** HTML shell with a strict, nonce-based Content Security Policy. */
export function renderWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, view: 'sidebar' | 'dashboard', initialTab = 'overview'): string {
  const nonce = getNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.css'));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'"
  ].join('; ');
  const tab = initialTab.replace(/[^a-z-]/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>ProjectLens</title>
</head>
<body data-view="${view}" data-tab="${tab}">
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
