import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GuardrunAgentConfig {
  apiKey: string;
  endpoint: string;
  /**
   * Behavior when a guardrail-check network call itself fails (backend
   * unreachable, not a rule match). docs/05-architecture-document.md
   * Section 8 requires this to be a configurable org-level setting but
   * never specifies where that setting lives -- there's no column for it
   * on `orgs` in the current schema. Implemented client-side for now via
   * env var / config file, defaulting to "open" (never block the user's
   * own work over a networking blip). Flagged as a gap-fill, not a
   * documented default.
   */
  failMode: "open" | "closed";
}

const CONFIG_DIR = path.join(os.homedir(), ".guardrunagent");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const QUEUE_DIR = path.join(CONFIG_DIR, "queue");
export const FAILED_EVENTS_FILE = path.join(CONFIG_DIR, "failed_events.jsonl");
export const RULE_CACHE_FILE = path.join(CONFIG_DIR, "rules-cache.json");
export const DEBUG_LOG_FILE = path.join(CONFIG_DIR, "debug.log");

interface ConfigFileShape {
  apiKey?: string;
  endpoint?: string;
  failMode?: "open" | "closed";
}

function readConfigFile(): ConfigFileShape {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as ConfigFileShape;
  } catch {
    return {};
  }
}

/**
 * Config resolves from environment variables first (so a one-shot hook
 * process needs no file I/O when the user has set them in their shell or
 * `.claude/settings.json` env block), falling back to
 * ~/.guardrunagent/config.json.
 *
 * There's no `initGuardrunAgent({ apiKey })` call site the way
 * docs/03-low-level-design.md Section 3.1's illustrative snippet shows --
 * each hook is a fresh process Claude Code itself invokes (see
 * hooks/hooks.json), not code the user writes and calls into.
 */
export function loadConfig(): GuardrunAgentConfig {
  const fileConfig = readConfigFile();

  const apiKey = process.env.GUARDRUNAGENT_API_KEY ?? fileConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      'GuardrunAgent: no API key configured. Set GUARDRUNAGENT_API_KEY or add "apiKey" to ~/.guardrunagent/config.json.'
    );
  }

  const endpoint = process.env.GUARDRUNAGENT_ENDPOINT ?? fileConfig.endpoint;
  if (!endpoint) {
    throw new Error(
      'GuardrunAgent: no backend endpoint configured. Set GUARDRUNAGENT_ENDPOINT or add "endpoint" to ~/.guardrunagent/config.json.'
    );
  }

  const failModeRaw = process.env.GUARDRUNAGENT_FAIL_MODE ?? fileConfig.failMode ?? "open";
  const failMode: "open" | "closed" = failModeRaw === "closed" ? "closed" : "open";

  return { apiKey, endpoint, failMode };
}

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}
