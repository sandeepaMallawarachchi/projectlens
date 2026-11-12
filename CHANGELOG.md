# Changelog

## 0.3.1

- **Prompt Guard:** catches more credentials in prompts:
  - `.env`-style values without quotes (`ADMIN_KEY=…`).
  - More credential names (passphrase, signing, salt, HMAC, cookie, `_SK`, and others) and provider names on their own (`OPENAI=…`, `STRIPE=…`).
  - Keys mentioned in sentences ("the admin key is …", "use … as the key"), `Bearer`/`Basic` headers, and long random-looking tokens under any name.
  - Ordinary words, commit hashes, UUIDs, empty values and `${VAR}` references are not flagged.

## 0.3.0

- **Prompt Guard:** checks prompts sent to AI coding tools for secrets and sensitive data, on your computer, before they are sent.
  - Supported tools: Claude Code, Codex and Cursor (blocked before sending), Antigravity (blocked before the model call) and GitHub Copilot (alert right after sending; Copilot hooks cannot block).
  - Detects API keys, tokens, private keys and connection strings, payment card numbers (Luhn-checked), email addresses and phone numbers, plus the organization's own terms and regular expressions, with an allowlist.
  - Blocked prompts show a sanitized copy to resend. Also available: "Copy Sanitized Prompt" and "Sanitize Selection or Clipboard".
  - Organization owners and admins set the policy from the new **Prompt Guard** dashboard tab or the API. Each policy is off, optional or required, and members see the organization's notice and rules before they accept.
  - Prompt text never leaves the computer. The organization sees only the matched rule, the tool, the project folder name and the time.
  - Hooks are added to each tool's user settings with a backup, run offline, and let prompts through if they ever fail.
- New `audit` API key scope for Prompt Guard reports.
- **Cloud API:** Prompt Guard endpoints. Run `supabase/migrations/003_prompt_guard.sql` on existing databases.

## 0.2.1

- Increased the default file size limit for local scans from 512 KB to 10 MB. Existing custom `projectlens.scan.maxFileSizeKb` values are preserved.
- Clarified the file size setting's units and default in VS Code Settings.
- **Cloud API (requires a separate backend deployment):** fixed GitLab archive downloads failing with HTTP 406 due to Node fetch metadata headers.
- **Cloud API:** increased the default download and analysis limit to 10 MB per file while preserving the 200 MB repository limit. `MAX_FILE_KB` still overrides the default.
- **Cloud API:** Analyze regenerates cached reports that skipped files under a smaller per-file download limit.

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
