# ProjectLens AI

ProjectLens is a VS Code extension that analyzes the workspace you have open and reports on its technologies, code quality, security risks, implementation progress and production readiness. All core analysis is **local and deterministic**. AI review is optional, works with **Groq, OpenAI, Google Gemini or Anthropic Claude**, and only runs when you trigger it and approve the exact context that will be sent.

> Everything ProjectLens reports is advisory static analysis. Each finding has a confidence level and a detection status. A scan with no findings does **not** prove a project is secure or complete.

---

## Features

| Area | What it does |
|---|---|
| **Activity Bar sidebar** | Project name, detected framework, scan status, last scan time, Quick / Full Scan, AI Deep Review, health scores, security and quality counts, progress estimate, dashboard and settings shortcuts. |
| **Dashboard (editor tab)** | Overview, Technologies, Progress, Code Quality, Security, AI Insights and Reports pages. Every finding links to its source location. |
| **Technology detection** | Reads `package.json`, npm/pnpm/yarn lockfiles, `tsconfig`, framework configs, Prisma schema, Docker, Vercel and CI files, plus the **actual imports** in your code. Each technology is labeled *used*, *configured* or *declared only*, with its evidence and a confidence level. |
| **Code quality** | Built-in ESLint rule set (run in memory) and TypeScript-AST rules: explicit `any`, unsafe assertions, `@ts-ignore`, empty catches, floating promises, async handlers without error handling, complexity, nesting, long functions, console use in server code, naming, duplicate blocks and TODO/FIXME markers. |
| **Security** | Hardcoded credentials (provider formats plus an entropy-checked generic rule), private keys and credential files, tracked or public-prefixed env secrets, SQL/NoSQL/command injection, `eval`, unsafe HTML, JWT misuse, tokens in `localStorage`, cookie flags, permissive CORS, disabled TLS verification, weak hashing and randomness, sensitive logging, open redirect, path traversal, mass assignment, webhook signature checks, authorization gaps, Next.js/Docker/Compose/GitHub Actions configuration, and an offline dependency advisory list. |
| **Progress estimation** | Infers functional modules from pages, API routes, Express routers, models and services. Each module is rated *Implemented* or *Partial* from evidence: placeholder functions, mock data, 501 responses, "coming soon" text, TODOs, and UI calls to API routes that don't exist. You can add an optional `.projectlens.json` for requirements-weighted completion. |
| **Transparent scoring** | Code Quality, Security Health, Implementation Evidence and Production Readiness are computed from named checks with weights. Each check's status (passed, failed, unavailable or skipped) is recorded and viewable under "Why this score?". Confirmed critical issues cap Security at 40. When evidence is too thin, the result is "Not assessed" rather than an invented number. |
| **Problems panel** | Deterministic, non-speculative findings at or above a configurable severity. AI output never appears here. |
| **AI review (optional)** | Choose Groq, OpenAI, Google Gemini or Anthropic Claude; each has its own key. Explain a finding, review a file or module, summarize the architecture, find incomplete patterns, prioritize improvements, explain security concerns, or produce a full project assessment (AI Deep Review). |
| **Reports** | JSON and Markdown export including scan timestamp, scope, coverage, warnings, scores with check tables, findings and AI insights. |
| **History** | Local scan summaries with score trends. |

## Requirements

- VS Code **1.90** or newer
- Node.js **20+** for development (tested with Node 24)
- Optional, for AI features: an API key from [Groq](https://console.groq.com/keys), [OpenAI](https://platform.openai.com/api-keys), [Google AI Studio](https://aistudio.google.com/apikey) or [Anthropic](https://console.anthropic.com/settings/keys)
- Optional: a locally installed [Gitleaks](https://github.com/gitleaks/gitleaks) binary

## Getting started (development)

```bash
npm install
npm run build        # type-check, bundle the extension (esbuild) and the React webview (Vite)
npm run lint
npm run test         # Vitest unit tests (125 tests, no network required)
```

### Run and debug in the Extension Development Host

1. Open this folder in VS Code.
2. Press **F5** and choose **Run ProjectLens**, or **Run ProjectLens on fixture (vulnerable-app)** to open a deliberately insecure sample project. Both configurations are in `.vscode/launch.json` and run `npm run build` first.
3. In the new window, click the **ProjectLens** icon in the Activity Bar, then **Quick Scan** or **Full Scan**.

For iterative work, run `npm run watch:extension` and `npm run watch:webview` in two terminals, then reload the development host window (`Developer: Reload Window`).

### Integration tests

```bash
npm run test:integration
```

This downloads a VS Code build into `.vscode-test/` on first run, opens `tests/fixtures/vulnerable-app`, and runs the Mocha suite in `tests/integration/`. It covers command registration, Quick and Full Scan, Problems-panel diagnostics, and opening the dashboard.

### Build a VSIX package

```bash
npm run package      # runs vsce package (vscode:prepublish builds first)
code --install-extension projectlens-0.1.0.vsix
```

To publish a new version to the Visual Studio Marketplace (publisher `SandeepaMallawarachchi`):

```bash
npx vsce login SandeepaMallawarachchi   # once; paste an Azure DevOps token with Marketplace → Manage scope
npx vsce publish patch                  # bumps the version, builds, and publishes
```

## Commands

| Command | Description |
|---|---|
| `ProjectLens: Quick Scan` | Manifests, technologies, secrets, environment, configuration and dependency checks. |
| `ProjectLens: Full Scan` | Everything in Quick Scan, plus AST security and quality rules, ESLint, markers, duplicates, progress evidence and (if enabled) Gitleaks. |
| `ProjectLens: Cancel Scan` | Cancels the running scan. |
| `ProjectLens: AI Deep Review` | AI project assessment from the latest scan, using the selected provider. |
| `ProjectLens: Review Current File with AI` | Also available from the editor context menu for JS/TS files. |
| `ProjectLens: Open Dashboard` | Opens the full dashboard in an editor tab. |
| `ProjectLens: Select AI Provider` | Switches between Groq, OpenAI, Google Gemini and Anthropic Claude. |
| `ProjectLens: Set AI API Key` / `Remove AI API Key` | Stores or removes a provider's key in SecretStorage. Each provider keeps its own key. |
| `ProjectLens: Test AI Connection` | Verifies the active provider's key and model by listing models (no tokens spent). |
| `ProjectLens: Select AI Model` | Lists the active provider's models and saves your choice for that provider. |
| `ProjectLens: Export Report as JSON` / `as Markdown` | Exports the latest scan. |
| `ProjectLens: Clear Scan History` | Deletes local history, the analysis cache, the latest result and AI insights. |
| `ProjectLens: Create .projectlens.json Requirements File` | Creates a requirements template. |

## Configuration

| Setting | Default | Notes |
|---|---|---|
| `projectlens.ai.provider` | `groq` | `groq`, `openai`, `gemini` or `anthropic`. |
| `projectlens.ai.groq.model` | `openai/gpt-oss-20b` | |
| `projectlens.ai.openai.model` | `gpt-5-mini` | |
| `projectlens.ai.gemini.model` | `gemini-2.5-flash` | |
| `projectlens.ai.anthropic.model` | `claude-opus-5-5` | |
| `projectlens.ai.maxContextTokens` | `6000` | Approximate input budget per request. |
| `projectlens.ai.maxOutputTokens` | `2500` | Claude uses at least 16000 and Gemini at least 8192, because thinking tokens count toward the limit. |
| `projectlens.ai.requestTimeoutSeconds` | `60` | |
| `projectlens.ai.maxRetries` | `3` | Applies to 429, 5xx, timeouts and network errors only. |
| `projectlens.ai.maxConcurrentRequests` | `2` | |
| `projectlens.ai.maxRequestsPerSession` | `40` | Hard cap across all providers. |
| `projectlens.scan.maxFileSizeKb` | `512` | Larger files are skipped and counted under coverage. |
| `projectlens.scan.maxFiles` | `8000` | Per workspace folder. |
| `projectlens.scan.respectGitignore` | `true` | Root and nested `.gitignore` files. |
| `projectlens.scan.exclude` | `[]` | Extra patterns in gitignore syntax. |
| `projectlens.gitleaks.enabled` / `.path` | `false` / `""` | Trusted workspaces only. |
| `projectlens.diagnostics.enabled` / `.minimumSeverity` | `true` / `medium` | |
| `projectlens.history.maxEntries` | `20` | |

## Requirements-based progress (`.projectlens.json`)

```json
{
  "version": 1,
  "features": [
    { "id": "auth", "name": "Authentication", "weight": 3, "match": ["auth", "login"] },
    { "id": "billing", "name": "Billing", "weight": 2, "match": ["billing"], "paths": ["app/billing/**"] }
  ]
}
```

Each feature is matched to detected modules, by keyword (`match`) or by file glob (`paths`). Its completion is the mean estimate of the matched modules; a feature with no match counts as 0% (*Not detected*). Overall completion is:

```
Completion = Σ(feature weight × estimated completion) / Σ(feature weights)
```

Without this file, ProjectLens shows **Implementation Evidence**: the mean completion of the modules it detected. That figure can't account for features that were never started.

## Security and privacy

- **API keys** for every provider are stored only in VS Code SecretStorage, which is backed by the OS keychain, one entry per provider. They are never written to settings, sent to the webview, logged, or included in reports.
- **AI requests** go directly from the extension host to the selected provider's API, using its official SDK (`groq-sdk`, `openai`, `@google/genai`, `@anthropic-ai/sdk`). SDKs are loaded only when that provider is first used. The webview's Content Security Policy blocks all network access (`connect-src 'none'`) and allows only nonce-tagged local scripts.
- **AI requests run only when you trigger them.** Before anything is sent, a modal shows the model, the file excerpts, the token estimate, how many values were redacted, and which files were excluded. **Preview Payload** opens the exact text.
- **The context builder:**
  - sends a compact summary of the local analysis plus only the relevant excerpts, within a token budget
  - never sends `.env*` files, keys, certificates, credential files, lockfiles or generated files
  - redacts detected secrets and private-key bodies
  - uses workspace-relative paths only
- **AI output is treated as untrusted data.** It is validated with Zod, file references that weren't in the provided context are dropped, and the output is rendered as plain text. It is never executed and never applied to your files.
- **Secrets are never shown in full.** The dashboard, reports, logs and diagnostics show redacted previews (for example `gsk_•••••• (56 chars)`).
- **Repository code is never executed.** ProjectLens doesn't run package scripts, migrations or the repository's ESLint config (flat configs are JavaScript). ESLint runs in memory with a built-in rule set.
- **Workspace Trust:** in restricted mode only the in-memory analyzers run, and Gitleaks is disabled. Gitleaks is never installed automatically; ProjectLens runs it only from an absolute path or PATH, with `execFile` (no shell), a timeout and `--redact`.
- **Local storage:** the latest result and a per-file analysis cache are kept in the workspace storage folder. They hold redacted single-line evidence and structural facts, never full source. History and AI insights are kept in `workspaceState`.
- **No telemetry.**

## Architecture

```
src/
  extension.ts                activation, command registration
  controller.ts               app state, scan/AI orchestration, typed webview messages
  config.ts                   settings access
  core/                       VS Code-independent engine
    fileDiscovery.ts          walk, .gitignore, excludes, binary and size limits, multi-root
    fileContext.ts            per-file context, roles (server/client/test), TS AST
    scanner.ts                Quick/Full pipeline, cancellation, yielding, cache use
    cache.ts                  per-file analysis cache (mtime/size/mode/version stamp)
    findings.ts               finding factory, stable IDs, dedupe, sorting
    report.ts                 JSON and Markdown reports
  analyzers/
    technology/               catalog, manifests and lockfiles, evidence-based detector
    quality/                  AST rules, in-memory ESLint, markers, duplicates
    security/                 secret patterns, env, AST rules, authorization, config, Gitleaks adapter
    progress/                 structural facts, module estimator, requirements
    dependencies/             offline dependency checks
  scoring/scoring.ts          check-based, explainable scores and recommended actions
  ai/
    AIProvider.ts             provider abstraction
    providers/                Groq and OpenAI (shared Chat Completions base), Gemini, Anthropic Claude;
                              structured output with fallback modes, shared error mapping
    retry.ts, errors.ts       backoff with Retry-After, error taxonomy
    contextBuilder.ts         selection, exclusion, redaction, budgeting
    aiService.ts              consent, limits, batching, validation
  models/                     shared types, Zod schemas, message protocol
  storage/                    SecretStorage wrapper, scan, history and insight storage
  views/                      sidebar and dashboard webviews, CSP HTML, diagnostics, navigation
webview/src/                  React dashboard (components, pages, hooks, styles)
tests/unit/                   Vitest suites
tests/integration/            VS Code Extension Host tests
tests/fixtures/               healthy-nextjs, vulnerable-app, partial-saas
```

To add support for a new language, add an analyzer that takes a `FileContext` and returns `Finding[]`, then register it in `core/scanner.ts`'s `analyzeFile`. To add a new AI provider, implement `AIProvider`.

## Known limitations

- AST-based analysis covers JavaScript and TypeScript only. Other languages get only the secret, environment and configuration rules, and the scan warns about this.
- Authorization checks are heuristic and are always marked *Needs review*. Global middleware lowers their severity, but ProjectLens can't prove that a route is protected.
- The dependency advisory list is a small, curated offline list. Run `npm audit` or an SCA tool for complete coverage.
- `tsconfig` `extends` chains aren't followed when checking `strict`.
- Express routes mounted under a prefix are matched by path suffix when checking UI→API connections. Projects using Next.js rewrites or a Vite proxy skip this check.
- Remote and virtual file systems aren't supported. Remote SSH and WSL work because the extension runs on the remote host.
- Gitleaks integration uses `gitleaks detect --no-git` and has been unit-tested against its JSON report format, but not against a live binary in this repository's CI.
- All four providers are covered by mocked API tests only. Running them against the live APIs requires your own keys.
- Claude requests on models that support it (Opus 5/5.5, Fable 5, Sonnet 5.5) enable Anthropic's server-side refusal fallback (`fallbacks: "default"`). Any remaining refusal from a provider is reported as "declined".
