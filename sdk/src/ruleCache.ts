import * as fs from "node:fs";

import { ensureConfigDir, RULE_CACHE_FILE, type GuardrunAgentConfig } from "./config";
import { debugLog } from "./debugLog";
import { getJson } from "./httpClient";
import type { CachedRule } from "./matcher";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, per docs/03-low-level-design.md Section 3.2

export interface OrgConfig {
  rules: CachedRule[];
  /** orgs.fail_mode, per docs/05-architecture-document.md Section 8 -- the
   * org-level fail-open/fail-closed setting. config.ts's failModeOverride
   * takes precedence over this on the SDK side when explicitly set. */
  failMode: "open" | "closed";
}

interface RuleCacheFile extends OrgConfig {
  fetchedAt: number;
}

/**
 * Returns the cached org config (guardrail rules + fail_mode), refreshing
 * from GET /rules first if the cache is missing or older than 5 minutes.
 *
 * There's no persistent SDK process to hold an in-memory timer across
 * tool calls (each hook invocation is a fresh process -- see
 * hooks/hooks.json). This file-backed cache, checked fresh on each
 * PreToolUse invocation, is the closest equivalent to the documented
 * "refresh every 5 minutes" (docs/03-low-level-design.md Section 3.2).
 *
 * If the refresh fails (backend unreachable), this falls back to
 * whatever is in the local cache file, or an empty rule set + "open"
 * fail_mode on a first run with no cache yet -- an empty rule set means
 * no rule can locally pre-match, so every guardrail-check network call is
 * skipped (see logic/preToolUseLogic.ts's fast path), which is the same
 * "don't block the user's own work" bias as fail_mode's own "open"
 * default.
 */
export async function getCachedOrgConfig(config: GuardrunAgentConfig): Promise<OrgConfig> {
  const cached = readCacheFile();
  const isFresh = cached !== null && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS;
  if (isFresh) {
    return { rules: cached!.rules, failMode: cached!.failMode };
  }

  try {
    const orgConfig = await fetchOrgConfig(config);
    writeCacheFile({ fetchedAt: Date.now(), ...orgConfig });
    return orgConfig;
  } catch (err) {
    debugLog(`rule cache refresh failed, falling back to stale cache: ${String(err)}`);
    return { rules: cached?.rules ?? [], failMode: cached?.failMode ?? "open" };
  }
}

function readCacheFile(): RuleCacheFile | null {
  try {
    return JSON.parse(fs.readFileSync(RULE_CACHE_FILE, "utf8")) as RuleCacheFile;
  } catch {
    return null;
  }
}

function writeCacheFile(data: RuleCacheFile): void {
  try {
    ensureConfigDir();
    fs.writeFileSync(RULE_CACHE_FILE, JSON.stringify(data));
  } catch (err) {
    debugLog(`failed to write rule cache: ${String(err)}`);
  }
}

async function fetchOrgConfig(config: GuardrunAgentConfig): Promise<OrgConfig> {
  const response = await getJson(config, "/rules");
  if (!response.ok) {
    throw new Error(`GET /rules failed: ${response.status}`);
  }
  const body = (await response.json()) as
    | { rules?: CachedRule[]; fail_mode?: "open" | "closed" }
    | CachedRule[];
  if (Array.isArray(body)) {
    return { rules: body, failMode: "open" };
  }
  return { rules: body.rules ?? [], failMode: body.fail_mode === "closed" ? "closed" : "open" };
}
