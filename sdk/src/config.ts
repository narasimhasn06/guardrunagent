import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GuardrunAgentConfig {
  apiKey: string;
  endpoint: string;
  /**
   * Per-machine override for behavior when a guardrail-check network call
   * itself fails (backend unreachable, not a rule match). `orgs.fail_mode`
   * (docs/05-architecture-document.md Section 8) is now the real,
   * org-level source of truth -- fetched alongside GET /rules and cached
   * the same way (see ruleCache.ts) -- so this is only consulted when set
   * explicitly, to let one machine override the org's setting (e.g. a
   * developer debugging offline who wants fail-closed locally regardless
   * of the org default). Undefined means "no override, use the org's
   * setting."
   */
  failModeOverride: "open" | "closed" | undefined;
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

  const failModeOverrideRaw = process.env.GUARDRUNAGENT_FAIL_MODE ?? fileConfig.failMode;
  const failModeOverride: "open" | "closed" | undefined =
    failModeOverrideRaw === "open" || failModeOverrideRaw === "closed" ? failModeOverrideRaw : undefined;

  return { apiKey, endpoint, failModeOverride };
}

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}
