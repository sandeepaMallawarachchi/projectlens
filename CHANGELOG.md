# Changelog

## 0.2.0

- **ProjectLens Cloud** page in the dashboard:
  - Sign in with GitHub or an email code.
  - Organizations and teams with invitations and roles.
  - Link the workspace to a cloud project, upload local scans (with consent, or automatically), and trigger cloud scans of GitHub/GitLab repositories.
  - Organization API keys for PM tools, the organization's own AI keys for cloud AI insights, and usage against free-plan limits.
- New commands: Open ProjectLens Cloud, Sign In/Out, Link Workspace to Cloud Project, Upload Latest Scan to Cloud, Run Cloud Scan.
- New settings: `projectlens.cloud.apiUrl`, `projectlens.cloud.autoUpload`.

## 0.1.1

- Clicking the ProjectLens icon in the Activity Bar now opens the dashboard as well as the sidebar. Turn this off with `projectlens.openDashboardOnSidebarOpen`.
- Internal: build tweaks so the shared analysis engine can also power the ProjectLens API (no behavior change in the extension).

## 0.1.0

Initial release:

- Activity Bar sidebar and full-tab React dashboard: Overview, Technologies, Progress, Code Quality, Security, AI Insights and Reports.
- Workspace scanner with Quick and Full modes, multi-root support, `.gitignore` handling, cancellation and a per-file cache.
- Technology detection based on manifests, lockfiles, configuration files and real import usage.
- Code-quality analysis with TypeScript-AST rules, an in-memory ESLint rule set, TODO/FIXME markers and duplicate-block detection.
- Security rules covering secrets, environment variables, injection, XSS, authentication tokens, CORS/TLS, logging, authorization, configuration and dependencies, plus an optional Gitleaks adapter.
- Evidence-based progress estimation, with optional `.projectlens.json` requirements.
- Transparent, check-based scoring and deterministic recommended actions.
- AI safety: SecretStorage credentials, consent previews, redaction, structured output with Zod validation, retries, rate-limit handling and session limits.
- JSON and Markdown reports, scan history, and diagnostics in the Problems panel.
- AI review with Groq, OpenAI, Google Gemini or Anthropic Claude, each with its own SecretStorage key and model setting; commands to select the provider and model and to set, test or remove keys.
- Provider SDKs are loaded lazily and the extension bundle is minified.
