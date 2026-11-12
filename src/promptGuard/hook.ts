/**
 * ProjectLens Prompt Guard hook (bundled to dist/prompt-guard.js, copied to ~/.projectlens/prompt-guard).
 * Usage: node prompt-guard.js <claude|codex|cursor|copilot|antigravity>  (hook input JSON on stdin)
 *
 * Runs fully offline against the locally synced policy. Prompt text never leaves the machine:
 * only metadata events are appended to events.jsonl, which the extension uploads.
 * Any unexpected error lets the prompt through (fail open) so a broken hook never blocks work.
 */
import { appendFileSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { AI_TOOLS, type AiTool, type LocalPromptPolicy } from '../models/promptGuard';
import { evaluateHook } from './hookCore';

const MAX_EVENTS_FILE = 1024 * 1024;
const MAX_STDIN = 2 * 1024 * 1024;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, 5000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      if (data.length < MAX_STDIN) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const tool = process.argv[2] as AiTool;
  if (!AI_TOOLS.includes(tool)) {
    return;
  }
  const dir = process.env.PROJECTLENS_PROMPT_GUARD_DIR || __dirname;
  const raw = await readStdin();
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const local = readJson<LocalPromptPolicy>(join(dir, 'policy.json'));
  const seenPath = join(dir, 'antigravity-seen.json');
  const seen = tool === 'antigravity' ? readJson<Record<string, boolean>>(seenPath) ?? {} : {};
  const outcome = evaluateHook(tool, input, local, seen);

  if (outcome.stdout) {
    // Synchronous: process.exit() below must not cut off a pending pipe write.
    writeSync(1, outcome.stdout);
  }
  try {
    if (outcome.event) {
      const eventsPath = join(dir, 'events.jsonl');
      let size = 0;
      try {
        size = statSync(eventsPath).size;
      } catch {
        // first event
      }
      if (size < MAX_EVENTS_FILE) {
        appendFileSync(eventsPath, `${JSON.stringify(outcome.event)}\n`, { mode: 0o600 });
      }
    }
    if (outcome.sanitized !== null) {
      writeFileSync(join(dir, 'last-sanitized.txt'), outcome.sanitized, { mode: 0o600 });
    }
    if (outcome.dedupeKey && !(outcome.dedupeKey in seen)) {
      const entries = Object.entries({ ...seen, [outcome.dedupeKey]: outcome.event?.action === 'blocked' }).slice(-50);
      writeFileSync(seenPath, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
    }
  } catch {
    // Bookkeeping failures never change the decision.
  }
}

main()
  .catch(() => undefined)
  .finally(() => process.exit(0));
