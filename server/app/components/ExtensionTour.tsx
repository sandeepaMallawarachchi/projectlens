'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Illustrated tour of the VS Code extension. The screens are drawn with HTML/CSS (not screenshots)
 * so they stay sharp, load instantly and contain only sample data.
 */

type Tone = 'good' | 'warn' | 'bad' | 'accent' | 'muted';

function Tag({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`vx-tag vx-${tone}`}>{children}</span>;
}

function Btn({ primary, pressed, children }: { primary?: boolean; pressed?: boolean; children: ReactNode }) {
  return <span className={`vx-btn ${primary ? 'vx-btn-primary' : ''} ${pressed ? 'vx-pressed' : ''}`}>{children}</span>;
}

function Meter({ value, tone }: { value: number; tone: Tone }) {
  return (
    <span className="vx-meter">
      <span className={`vx-meter-fill vx-bg-${tone}`} style={{ width: `${value}%` }} />
    </span>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scripted demo: returns the current stage (0…times.length). Stage n starts at times[n-1] ms.
 * Each screen remounts when its step opens, so the script replays. Reduced motion jumps to the end.
 */
function useStage(times: number[]): number {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setStage(times.length);
      return;
    }
    const timers = times.map((t, i) => setTimeout(() => setStage(i + 1), t));
    return () => timers.forEach(clearTimeout);
  }, []);
  return stage;
}

/** Counts from `from` to `to` over `ms` once `start` is true. */
function useCount(to: number, start: boolean, ms = 1200, from = 0): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!start) {
      return;
    }
    if (prefersReducedMotion()) {
      setValue(to);
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      setValue(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) {
        clearInterval(timer);
      }
    }, 33);
    return () => clearInterval(timer);
  }, [start, to, ms, from]);
  return value;
}

/** Types `text` character by character once `start` is true. */
function useTyping(text: string, start: boolean, ms = 1600): string {
  const n = useCount(text.length, start, ms);
  return text.slice(0, n);
}

const NAV = ['Overview', 'Technologies', 'Progress', 'Code Quality', 'Security', 'AI Insights', 'Cloud', 'Prompt Guard', 'Reports'];

/** VS Code window frame with the ProjectLens dashboard tab. */
function Window({ active, children, statusRight, chat, scanPressed }: { active: string; children: ReactNode; statusRight?: ReactNode; chat?: ReactNode; scanPressed?: boolean }) {
  return (
    <div className={`vx-window ${chat ? 'vx-has-chat' : ''}`} aria-hidden>
      <div className="vx-titlebar">
        <span className="vx-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="vx-title">acme-web</span>
      </div>
      <div className="vx-body">
        <div className="vx-activity">
          <span className="vx-act" />
          <span className="vx-act" />
          <span className="vx-act" />
          <span className="vx-act vx-act-on">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-4.2-4.2" />
            </svg>
          </span>
        </div>
        <div className="vx-main">
          <div className="vx-tabs">
            <span className="vx-tab vx-tab-on">ProjectLens</span>
            <span className="vx-tab">app.tsx</span>
          </div>
          <div className="vx-dash">
            <nav className="vx-nav">
              <strong>ProjectLens</strong>
              {NAV.map((n) => (
                <span key={n} className={n === active ? 'vx-nav-on' : ''}>
                  {n}
                </span>
              ))}
            </nav>
            <div className="vx-page">
              <div className="vx-toolbar">
                <b>acme-web</b>
                <span className="vx-spacer" />
                <Btn>Quick Scan</Btn>
                <Btn primary pressed={scanPressed}>
                  Full Scan
                </Btn>
                <Btn>AI Deep Review</Btn>
              </div>
              {children}
            </div>
          </div>
        </div>
        {chat}
      </div>
      <div className="vx-status">
        <span>main</span>
        <span className="vx-spacer" />
        {statusRight}
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="vx-card">
      <div className="vx-card-title">{title}</div>
      {sub && <div className="vx-sub">{sub}</div>}
      {children}
    </div>
  );
}

function Score({ label, value, grade, tone, on, delay }: { label: string; value: number; grade: string; tone: Tone; on: boolean; delay: number }) {
  // Start one tick after mount so the bar animates from zero.
  const ready = useStage([60]) >= 1 && on;
  const v = useCount(value, ready, 1100);
  return (
    <div className={`vx-score vx-in`} style={{ animationDelay: `${delay}ms` }}>
      <span className="vx-sub">{label}</span>
      <span className="vx-big">
        {v}
        <small>/100</small> {ready && v === value && <Tag tone={tone}>{grade}</Tag>}
      </span>
      <Meter value={ready ? value : 0} tone={tone} />
      <span className="vx-link">Why this score?</span>
    </div>
  );
}

function ScanScreen() {
  // 0 idle → 1 Full Scan pressed + scanning → 2 results
  const stage = useStage([500, 2900]);
  const files = useCount(312, stage >= 1, 2200);
  const scores: [string, number, string, Tone][] = [
    ['Code Quality', 82, 'B', 'good'],
    ['Security', 64, 'C', 'warn'],
    ['Implementation', 71, 'B', 'good'],
    ['Production Ready', 48, 'D', 'bad']
  ];
  return (
    <Window active="Overview" scanPressed={stage === 1}>
      {stage < 2 ? (
        <Card title={stage === 1 ? 'Full scan in progress…' : 'Ready to scan'} sub={stage === 1 ? `Analyzing src/ · ${files} files` : 'Choose Quick Scan or Full Scan'}>
          <span className="vx-meter vx-meter-lg">
            <span className="vx-meter-fill vx-bg-accent vx-scanbar" style={{ width: stage === 1 ? '100%' : '0%' }} />
          </span>
          {stage === 1 && <div className="vx-sub vx-shimmer">Technologies · Code quality · Security rules · Progress</div>}
        </Card>
      ) : (
        <>
          <div className="vx-card vx-in">
            <div className="vx-card-title">Summary</div>
            <div className="vx-sub">Full scan · just now · 2.4 s</div>
            <div className="vx-text">Next.js project written mainly in TypeScript · 312 files analyzed · data layer: Prisma · auth: NextAuth.</div>
          </div>
          <div className="vx-grid4">
            {scores.map(([l, v, g, t], i) => (
              <Score key={l} label={l} value={v} grade={g} tone={t} on delay={i * 120} />
            ))}
          </div>
          <div className="vx-stats vx-in" style={{ animationDelay: '600ms' }}>
            <span className="vx-stat vx-stat-bad">
              <b>2</b>Critical
            </span>
            <span className="vx-stat vx-stat-warn">
              <b>5</b>High
            </span>
            <span className="vx-stat">
              <b>18</b>Security
            </span>
            <span className="vx-stat">
              <b>74%</b>Requirements
            </span>
          </div>
        </>
      )}
    </Window>
  );
}

function FindingsScreen() {
  const rows: [string, Tone, string, string, string][] = [
    ['critical', 'bad', 'Hardcoded Stripe secret key', 'src/lib/billing.ts:12', 'sk_live_•••••• (32 chars)'],
    ['high', 'bad', 'SQL built from request input', 'src/app/api/users/route.ts:41', '`SELECT * FROM users WHERE id = ${…}`'],
    ['medium', 'warn', 'Missing rate limit on login', 'src/app/api/auth/route.ts:8', 'POST handler without limiter'],
    ['low', 'muted', 'TODO left in payment flow', 'src/app/checkout/page.tsx:77', '// TODO: handle declined cards']
  ];
  // Highlight the first finding as if hovered, after the list has appeared.
  const stage = useStage([2200]);
  return (
    <Window active="Security">
      <Card title="Security findings" sub="Static analysis with stated confidence. Evidence is redacted.">
        <div className="vx-filters">
          <Tag tone="bad">Critical 2</Tag>
          <Tag tone="warn">High 5</Tag>
          <Tag>Medium 7</Tag>
          <Tag>Low 4</Tag>
        </div>
        {rows.map(([sev, tone, title, file, ev], i) => (
          <div key={title} className={`vx-finding vx-in-left ${stage >= 1 && i === 0 ? 'vx-hover' : ''}`} style={{ animationDelay: `${200 + i * 350}ms` }}>
            <Tag tone={tone}>{sev}</Tag>
            <div>
              <div className="vx-strong">{title}</div>
              <div className="vx-file">
                {file}
                {stage >= 1 && i === 0 && <span className="vx-open"> → open at line 12</span>}
              </div>
              <code className="vx-code">{ev}</code>
            </div>
          </div>
        ))}
      </Card>
    </Window>
  );
}

function AiScreen() {
  // 0 consent → 1 Send pressed → 2 analyzing → 3 results
  const stage = useStage([1500, 1900, 3300]);
  const items = [
    'Billing reads a live Stripe key from source. Move it to environment variables.',
    'Checkout and orders modules are complete; refunds are a stub.',
    'Add tests around auth before production.'
  ];
  return (
    <Window active="AI Insights">
      <Card title="AI Insights" sub="Optional. Uses your own key: Groq, OpenAI, Gemini or Claude.">
        <div className="vx-row">
          <span className="vx-select">Claude · claude-sonnet</span>
          <Btn primary>Project assessment</Btn>
          <Btn>Security concerns</Btn>
        </div>
      </Card>
      {stage < 2 && (
        <div className="vx-modal vx-in">
          <div className="vx-strong">Send to Claude?</div>
          <div className="vx-text">Summary of the local analysis + 6 file excerpts · ~3,900 tokens · 2 values redacted · .env files never sent.</div>
          <div className="vx-row">
            <Btn primary pressed={stage === 1}>
              Send
            </Btn>
            <Btn>Preview payload</Btn>
          </div>
        </div>
      )}
      {stage === 2 && (
        <div className="vx-card vx-in">
          <div className="vx-card-title">Analyzing…</div>
          <span className="vx-skel" />
          <span className="vx-skel vx-skel-short" />
          <span className="vx-skel" />
        </div>
      )}
      {stage === 3 && (
        <div className="vx-card vx-in">
          <div className="vx-card-title">Project assessment</div>
          <div className="vx-sub">AI-generated · validated against the scan</div>
          <ul className="vx-list">
            {items.map((t, i) => (
              <li key={t} className="vx-in" style={{ animationDelay: `${i * 300}ms` }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Window>
  );
}

function CloudScreen() {
  // 0 idle → 1 uploading → 2 uploaded
  const stage = useStage([900, 2300]);
  const security = useCount(64, stage >= 2, 900, 58);
  return (
    <Window active="Cloud">
      <Card title="ProjectLens Cloud" sub="Signed in as alex@acme.dev">
        <div className="vx-row">
          <span className="vx-select">Acme Engineering · owner</span>
          <Tag tone="good">Workspace linked</Tag>
        </div>
        <div className="vx-row">
          <Btn primary pressed={stage === 1}>
            {stage === 1 ? 'Uploading…' : 'Upload latest scan'}
          </Btn>
          <Btn>Run cloud scan</Btn>
        </div>
        {stage >= 2 && <div className="vx-toast vx-in">✓ Scan uploaded to Acme Engineering. Your PM tool sees it now.</div>}
      </Card>
      <Card title="Projects (3)" sub="The same data your PM tool reads through the API.">
        {(
          [
            ['acme-web', security, 82],
            ['acme-api', 77, 70],
            ['mobile-app', 58, 66]
          ] as const
        ).map(([n, s, q], i) => (
          <div key={n} className={`vx-proj ${i === 0 && stage >= 2 ? 'vx-flash' : ''}`}>
            <b>{n}</b>
            <span className="vx-sub">Security {s}</span>
            <Meter value={s} tone={s > 70 ? 'good' : 'warn'} />
            <span className="vx-sub">Quality {q}</span>
            <Meter value={q} tone="good" />
            {i === 0 && stage >= 2 && <Tag tone="accent">just now</Tag>}
          </div>
        ))}
      </Card>
    </Window>
  );
}

function GuardScreen() {
  const tools: [string, string][] = [
    ['Claude Code', 'Blocks before sending'],
    ['Codex', 'Blocks before sending'],
    ['Cursor', 'Blocks before sending'],
    ['GitHub Copilot', 'Alerts after sending'],
    ['Antigravity', 'Blocks before sending']
  ];
  const prompt = 'STRIPE_SECRET=sk_live_9xQ2… why does checkout fail?';
  // 0 typing → 1 Enter → 2 blocked
  const stage = useStage([2300, 2700]);
  const typed = useTyping(prompt, true, 2000);
  return (
    <Window
      active="Prompt Guard"
      statusRight={<span className={`vx-status-pg ${stage >= 2 ? 'vx-pulse' : ''}`}>🛡 Prompt Guard: on</span>}
      chat={
        <div className="vx-chat">
          <div className="vx-sub">AI chat · Claude Code</div>
          {stage >= 2 && (
            <div className="vx-blocked vx-in">
              <b>Blocked by ProjectLens Prompt Guard</b>
              <span>Found: Stripe key. Nothing was sent. Resend this sanitized copy:</span>
              <code>STRIPE_SECRET=[REDACTED credential] why does checkout fail?</code>
            </div>
          )}
          <div className="vx-spacer" />
          <div className={`vx-input ${stage === 1 ? 'vx-pressed' : ''}`}>
            {stage >= 2 ? <span className="vx-sub">Ask anything…</span> : typed}
            {stage < 2 && <span className="vx-caret" />}
          </div>
        </div>
      }
    >
      <Card title="Prompt Guard · Acme Engineering" sub="Checks prompts on this computer before they reach AI tools.">
        <div className="vx-row">
          <span className="vx-sub">Policy</span>
          <Tag tone="accent">Required for all members</Tag>
          <span className="vx-sub">Consent</span>
          <Tag tone="good">Accepted</Tag>
        </div>
      </Card>
      <Card title="AI tools on this computer">
        {tools.map(([t, p]) => (
          <div key={t} className="vx-proj">
            <b>{t}</b>
            <Tag tone="good">Installed</Tag>
            <span className="vx-sub">{p}</span>
          </div>
        ))}
      </Card>
    </Window>
  );
}

function InstallScreen() {
  // 0 idle → 1 installing → 2 installed (icon appears)
  const stage = useStage([1000, 2500]);
  const logo = (size: number) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
  return (
    <div className="vx-window" aria-hidden>
      <div className="vx-titlebar">
        <span className="vx-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="vx-title">Extensions</span>
      </div>
      <div className="vx-body">
        <div className="vx-activity">
          <span className="vx-act" />
          <span className="vx-act vx-act-on">⊞</span>
          <span className="vx-act" />
          <span className="vx-act" />
          {stage >= 2 && <span className="vx-act vx-act-new">{logo(14)}</span>}
        </div>
        <div className="vx-side">
          <div className="vx-search">projectlens</div>
          <div className="vx-ext vx-ext-on">
            <span className="vx-ext-logo">{logo(18)}</span>
            <div>
              <b>ProjectLens AI</b>
              <div className="vx-sub">Code quality, security, progress and readiness</div>
              <div className="vx-sub">SandeepaMallawarachchi · ★★★★★</div>
            </div>
          </div>
        </div>
        <div className="vx-main vx-detail">
          <div className="vx-detail-head">
            <span className="vx-ext-logo vx-ext-logo-lg">{logo(30)}</span>
            <div>
              <div className="vx-h">ProjectLens AI</div>
              <div className="vx-sub">Analyze your workspace locally. AI is optional.</div>
              <div className="vx-row">
                {stage === 0 && <Btn primary>Install</Btn>}
                {stage === 1 && (
                  <Btn primary pressed>
                    Installing…
                  </Btn>
                )}
                {stage === 2 && <Tag tone="good">✓ Installed</Tag>}
              </div>
              {stage === 1 && (
                <span className="vx-meter vx-meter-lg">
                  <span className="vx-meter-fill vx-bg-accent vx-scanbar" style={{ width: '100%', animationDuration: '1.4s' }} />
                </span>
              )}
            </div>
          </div>
          <ul className="vx-list">
            <li>Technologies, code quality and security findings</li>
            <li>Implementation progress and production readiness scores</li>
            <li>Optional AI insights with your own key</li>
            <li>Team cloud, API for PM tools, Prompt Guard</li>
          </ul>
          {stage >= 2 && <div className="vx-toast vx-in">Click the ProjectLens icon in the Activity Bar to open the dashboard.</div>}
        </div>
      </div>
      <div className="vx-status">
        <span>Ln 1, Col 1</span>
      </div>
    </div>
  );
}

const STEPS: { id: string; title: string; text: ReactNode; screen: () => ReactNode }[] = [
  {
    id: 'install',
    title: 'Install and open',
    text: (
      <>
        Search <b>ProjectLens AI</b> in the Extensions view and install it. Click the magnifier icon in the Activity Bar to open the dashboard.
      </>
    ),
    screen: InstallScreen
  },
  {
    id: 'scan',
    title: 'Scan your workspace',
    text: (
      <>
        <b>Quick Scan</b> checks manifests, technologies, secrets and configuration in seconds. <b>Full Scan</b> adds code quality, AST security rules and progress. Click
        any score to see exactly how it was calculated.
      </>
    ),
    screen: ScanScreen
  },
  {
    id: 'findings',
    title: 'Review findings',
    text: (
      <>
        Security and Code Quality list every finding with severity, confidence and a link to the line. Secrets are always shown redacted. Export reports as Markdown or
        JSON.
      </>
    ),
    screen: FindingsScreen
  },
  {
    id: 'ai',
    title: 'Ask AI (optional)',
    text: (
      <>
        Add your own Groq, OpenAI, Gemini or Claude key. Before anything is sent you see the model, the excerpts, the token estimate and what was redacted.
      </>
    ),
    screen: AiScreen
  },
  {
    id: 'cloud',
    title: 'Share with your team',
    text: (
      <>
        On the <b>Cloud</b> page, sign in, link the workspace and upload scans or run cloud scans. Invite teammates and create API keys for your project-management tool.
      </>
    ),
    screen: CloudScreen
  },
  {
    id: 'guard',
    title: 'Protect AI prompts',
    text: (
      <>
        <b>Prompt Guard</b> blocks secrets and sensitive data before they reach Claude Code, Codex, Cursor or Antigravity, and alerts for GitHub Copilot. Prompts are
        checked on your computer and never uploaded.
      </>
    ),
    screen: GuardScreen
  }
];

const AUTO_MS = 10_000;

export function ExtensionTour({ initial = 0 }: { initial?: number }) {
  const [index, setIndex] = useState(initial);
  // Bumped on every step change so the timer and progress bar restart.
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const firstScroll = useRef(true);

  const go = (i: number) => {
    setIndex((i + STEPS.length) % STEPS.length);
    setCycle((c) => c + 1);
  };

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const el = rootRef.current;
    const io = el ? new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 }) : null;
    if (el && io) {
      io.observe(el);
    }
    return () => {
      mq.removeEventListener('change', sync);
      io?.disconnect();
    };
  }, []);

  // On narrow screens the steps are a horizontal row: keep the active one centered.
  // Scrolls only that row (never the page), and only when the row actually overflows.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[index] as HTMLElement | undefined;
    if (!list || !item || list.scrollWidth <= list.clientWidth) {
      return;
    }
    const left = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
    // First position is instant (no visible jump on load); later changes glide.
    list.scrollTo({ left: Math.max(0, left), behavior: reduced || firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [index, reduced]);

  const running = visible && !paused && !reduced;
  useEffect(() => {
    if (!running) {
      return;
    }
    const t = setTimeout(() => go(index + 1), AUTO_MS);
    return () => clearTimeout(t);
  }, [running, index, cycle]);

  const step = STEPS[index];
  const Screen = step.screen;
  return (
    <div
      className="tour"
      ref={rootRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <ol className="tour-steps" ref={listRef} role="tablist" aria-label="Extension tour">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button role="tab" aria-selected={i === index} aria-controls="tour-panel" className={`tour-step ${i === index ? 'tour-step-on' : ''}`} onClick={() => go(i)}>
              <span className="step-num">{i + 1}</span>
              <span className="tour-step-body">
                <span className="tour-step-title">{s.title}</span>
                <span className="tour-step-text">{s.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="tour-panel" id="tour-panel" role="tabpanel" aria-label={step.title}>
        <p className="tour-mobile-text">{step.text}</p>
        <div key={step.id} className="tour-screen">
          <Screen />
        </div>
        <div className="tour-progress" aria-hidden>
          {/* Restarts with the timer: on step change, and from zero when resuming after a pause. */}
          {running && <span key={`${index}-${cycle}`} className="tour-progress-bar" style={{ animationDuration: `${AUTO_MS}ms` }} />}
        </div>
        <div className="tour-nav">
          <button className="tour-arrow" onClick={() => go(index - 1)} aria-label="Previous step">
            ←
          </button>
          <span>
            {index + 1} / {STEPS.length} · {step.title}
          </span>
          <button className="tour-arrow" onClick={() => go(index + 1)} aria-label="Next step">
            →
          </button>
        </div>
      </div>
    </div>
  );
}
