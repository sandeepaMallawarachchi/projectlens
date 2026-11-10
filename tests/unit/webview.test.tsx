import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { scanFixture } from './helpers';
import { Overview } from '../../webview/src/pages/Overview';
import { Technologies } from '../../webview/src/pages/Technologies';
import { Progress } from '../../webview/src/pages/Progress';
import { QualityPage, SecurityPage } from '../../webview/src/pages/FindingsPages';
import { AIInsights } from '../../webview/src/pages/AIInsights';
import { Reports } from '../../webview/src/pages/Reports';
import type { AppState } from '../../src/models/messages';

describe('dashboard rendering', () => {
  it.each(['vulnerable-app', 'healthy-nextjs', 'partial-saas'])('renders every page for %s', async (name) => {
    const result = await scanFixture(name);
    const state: AppState = {
      workspace: { name, folders: 1, trusted: true },
      scan: null,
      lastError: null,
      result,
      history: [],
      settings: { gitleaksEnabled: false, diagnosticsEnabled: true },
      ai: {
        hasApiKey: false,
        model: 'openai/gpt-oss-20b',
        availableModels: [],
        running: null,
        lastError: null,
        connection: { status: 'unknown', message: 'Not tested' },
        insights: [],
        sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 }
      }
    };
    const noop = () => undefined;
    const pages = [
      <Overview key="o" result={result} onFocus={noop} />,
      <Technologies key="t" result={result} />,
      <Progress key="p" result={result} aiEnabled={false} aiBusy={false} />,
      <QualityPage key="q" result={result} focus={null} onClearFocus={noop} aiEnabled={false} aiBusy={false} />,
      <SecurityPage key="s" result={result} focus={null} onClearFocus={noop} aiEnabled={false} aiBusy={false} />,
      <AIInsights key="a" state={state} hasResult />,
      <Reports key="r" result={result} history={[]} />
    ];
    for (const page of pages) {
      expect(renderToString(page).length).toBeGreaterThan(100);
    }
    const security = renderToString(<SecurityPage result={result} focus={null} onClearFocus={noop} aiEnabled={false} aiBusy={false} />);
    expect(security).not.toContain('Qz8vT2mLx9Rk4Wp7');
  });
});
