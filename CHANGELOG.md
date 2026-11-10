# Changelog

## 0.1.0

Initial MVP:

- Activity Bar sidebar and full-tab React dashboard: Overview, Technologies, Progress, Code Quality, Security, AI Insights and Reports.
- Workspace scanner with Quick and Full modes, multi-root support, `.gitignore` handling, cancellation and a per-file cache.
- Technology detection based on manifests, lockfiles, configuration files and real import usage.
- Code-quality analysis with TypeScript-AST rules, an in-memory ESLint rule set, TODO/FIXME markers and duplicate-block detection.
- Security rules covering secrets, environment variables, injection, XSS, authentication tokens, CORS/TLS, logging, authorization, configuration and dependencies, plus an optional Gitleaks adapter.
- Evidence-based progress estimation, with optional `.projectlens.json` requirements.
- Transparent, check-based scoring and deterministic recommended actions.
- Groq Cloud integration: SecretStorage credentials, consent previews, redaction, structured output with Zod validation, retries, rate-limit handling and session limits.
- JSON and Markdown reports, scan history, and diagnostics in the Problems panel.
