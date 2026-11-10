import { useEffect, useState } from 'react';
import type { AppState, HostMessage } from '../../../src/models/messages';
import { post } from '../vscode';

export interface Toast {
  id: number;
  level: 'info' | 'error';
  message: string;
}

/** Subscribes to state pushed by the extension host. */
export function useHostState(onNavigate?: (tab: string) => void) {
  const [state, setState] = useState<AppState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'state') {
        setState(msg.state);
      } else if (msg.type === 'navigate') {
        onNavigate?.(msg.tab);
      } else if (msg.type === 'toast') {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-2), { id, level: msg.level, message: msg.message }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
      }
    };
    window.addEventListener('message', handler);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, [onNavigate]);

  return { state, toasts, dismiss: (id: number) => setToasts((t) => t.filter((x) => x.id !== id)) };
}
