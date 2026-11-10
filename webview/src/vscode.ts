import type { WebviewMessage } from '../../src/models/messages';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined };

/** Typed bridge to the extension host. The webview never sees credentials. */
export function post(message: WebviewMessage): void {
  api.postMessage(message);
}

export function getPersisted<T>(): Partial<T> {
  return (api.getState() as Partial<T>) ?? {};
}

export function setPersisted<T>(value: T): void {
  api.setState(value);
}

export function openFile(uri: string, line?: number, column?: number, endLine?: number, endColumn?: number): void {
  post({ type: 'openFile', uri, line, column, endLine, endColumn });
}
