import * as fs from "node:fs";

import { ensureConfigDir, RULE_CACHE_FILE, type GuardrunAgentConfig } from "./config";
import { debugLog } from "./debugLog";
import { getJson } from "./httpClient";
import type { CachedRule } from "./matcher";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, per docs/03-low-level-design.md Section 3.2

interface RuleCacheFile {
  fetchedAt: number;
  rules: CachedRule[];
}

/**
 * Returns cached guardrail rules, refreshing from GET /rules first if the
 * cache is missing or older than 5 minutes.
 *
 * GAP: GET /rules is described in docs/03-low-level-design.md Section 3.2
 * ("fetch active guardrail rules for the org... cache in memory") but was
 * never built on the backend -- Step 5 only covered /events,
 * /guardrail-check, /sessions/:id, /cost-summary. This client code is
 * written against the LLD's implied contract (API-key auth, returns the
 * org's guardrail_rules rows) but the endpoint doesn't exist yet; until
 * it does, refreshes will fail and this silently falls back to whatever
 * is in the local cache file (or an empty rule set on first run, meaning
 * no rule can locally pre-match and every guardrail-check network call is
 * skipped -- effectively no guardrails enforced until /rules exists).
 *
 * There's also no persistent SDK process to hold an in-memory timer
 * across tool calls (each hook invocation is a fresh process -- see
 * hooks/hooks.json). This file-backed cache, checked fresh on each
 * PreToolUse invocation, is the closest equivalent to the documented
 * "refresh every 5 minutes."
 */
export async function getCachedRules(config: GuardrunAgentConfig): Promise<CachedRule[]> {
  const cached = readCacheFile();
  const isFresh = cached !== null && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS;
  if (isFresh) {
    return cached!.rules;
  }

  try {
    const rules = await fetchRules(config);
    writeCacheFile({ fetchedAt: Date.now(), rules });
    return rules;
  } catch (err) {
    debugLog(`rule cache refresh failed, falling back to stale cache: ${String(err)}`);
    return cached?.rules ?? [];
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

async function fetchRules(config: GuardrunAgentConfig): Promise<CachedRule[]> {
  const response = await getJson(config, "/rules");
  if (!response.ok) {
    throw new Error(`GET /rules failed: ${response.status}`);
  }
  const body = (await response.json()) as { rules?: CachedRule[] } | CachedRule[];
  return Array.isArray(body) ? body : (body.rules ?? []);
}
