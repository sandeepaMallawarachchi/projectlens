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
import { CloudPage } from '../../webview/src/pages/Cloud';
import { EMPTY_CLOUD_STATE } from '../../src/models/cloud';

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
      cloud: EMPTY_CLOUD_STATE('https://projectlensai.vercel.app/api/v1'),
      ai: {
        provider: 'anthropic',
        providers: [
          { id: 'groq', label: 'Groq', hasApiKey: true, model: 'openai/gpt-oss-20b' },
          { id: 'openai', label: 'OpenAI', hasApiKey: false, model: 'gpt-5-mini' },
          { id: 'gemini', label: 'Google Gemini', hasApiKey: false, model: 'gemini-2.5-flash' },
          { id: 'anthropic', label: 'Anthropic Claude', hasApiKey: false, model: 'claude-opus-5-5' }
        ],
        hasApiKey: false,
        model: 'claude-opus-5-5',
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
    const ai = renderToString(<AIInsights state={state} hasResult />);
    for (const label of ['Groq', 'OpenAI', 'Google Gemini', 'Anthropic Claude']) {
      expect(ai).toContain(label);
    }
    // Cloud: signed out and signed in (with a linked project and a member role).
    expect(renderToString(<CloudPage state={state} />)).toContain('Sign in with GitHub');
    const signedIn: AppState = {
      ...state,
      cloud: {
        ...state.cloud,
        signedIn: true,
        user: { name: 'Ann', email: 'ann@example.com', githubLogin: 'ann' },
        organizations: [{ id: 'o1', name: 'Acme', role: 'member', plan: 'free' }],
        currentOrgId: 'o1',
        members: [{ userId: 'u1', name: 'Ann', email: 'ann@example.com', githubLogin: 'ann', role: 'member', joinedAt: '2026-01-01T00:00:00Z' }],
        aiKeys: [{ provider: 'groq', label: 'Groq', configured: true, last4: 'abcd', defaultModel: 'm' }],
        projects: [{ id: 'p1', name: 'Web', provider: 'github', repository: 'acme/web', externalId: 'pm-1', hasAccessToken: false, latestScan: { id: 's', status: 'completed', source: 'upload', finishedAt: '2026-01-01T00:00:00Z', commitSha: 'abc1234', scores: { quality: 80, security: 70, implementation: 90, readiness: 75 }, critical: 0, high: 1 } }],
        linkedProjectId: 'p1',
        usage: { limits: { projects: 25, cloudScansPerDay: 100, uploadsPerDay: 200, aiInsightsPerDay: 50 }, last24h: { cloudScans: 1, uploads: 2, aiInsights: 0 }, projects: 1 }
      }
    };
    const cloudHtml = renderToString(<CloudPage state={signedIn} />);
    expect(cloudHtml).toContain('Linked to');
    expect(cloudHtml).toContain('Only organization admins can manage API keys');
    expect(cloudHtml).toContain('•••• abcd');
  });
});
