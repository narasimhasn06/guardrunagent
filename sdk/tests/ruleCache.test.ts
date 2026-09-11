import * as os from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardrunAgentConfig } from "../src/config";
import type { CachedRule } from "../src/matcher";

/**
 * getCachedOrgConfig writes to a fixed path under os.homedir()
 * (RULE_CACHE_FILE, see config.ts) rather than an injectable one like
 * queue.ts's QueuePaths -- mocking node:fs entirely (an in-memory file
 * map, keyed by whatever path string it's called with) tests the real
 * read/refresh/fallback logic without touching the actual home directory
 * of whatever machine runs this suite. vi.mock is hoisted above the
 * imports below, so ruleCache.ts picks up this mock when it imports
 * node:fs itself.
 */
const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  readFileSync: (filePath: string) => {
    const contents = files.get(filePath);
    if (contents === undefined) throw new Error(`ENOENT: ${filePath}`);
    return contents;
  },
  writeFileSync: (filePath: string, data: string) => {
    files.set(filePath, data);
  },
  appendFileSync: (filePath: string, data: string) => {
    files.set(filePath, (files.get(filePath) ?? "") + data);
  },
  mkdirSync: () => undefined,
}));

import { getCachedOrgConfig } from "../src/ruleCache";

const CACHE_FILE_PATH = path.join(os.homedir(), ".guardrunagent", "rules-cache.json");

const CONFIG: GuardrunAgentConfig = {
  apiKey: "test-key",
  endpoint: "https://backend.example",
  failModeOverride: undefined,
};

const RULE: CachedRule = {
  id: "rule-1",
  name: "no-force-push-main",
  pattern_type: "command_regex",
  pattern_value: "^git push --force",
  action_on_match: "block",
  enabled: true,
};

function seedCacheFile(data: { fetchedAt: number; rules: CachedRule[]; failMode: "open" | "closed" }): void {
  files.set(CACHE_FILE_PATH, JSON.stringify(data));
}

beforeEach(() => {
  files.clear();
  vi.unstubAllGlobals();
});

describe("getCachedOrgConfig", () => {
  it("fetches and caches rules + fail_mode on first run (no cache file yet)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [RULE], fail_mode: "closed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCachedOrgConfig(CONFIG);

    expect(result).toEqual({ rules: [RULE], failMode: "closed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("defaults fail_mode to 'open' when the backend response omits it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [] }) }));

    const result = await getCachedOrgConfig(CONFIG);

    expect(result.failMode).toBe("open");
  });

  it("returns the cached value without a network call when the cache is fresh", async () => {
    seedCacheFile({ fetchedAt: Date.now(), rules: [RULE], failMode: "closed" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCachedOrgConfig(CONFIG);

    expect(result).toEqual({ rules: [RULE], failMode: "closed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes when the cache is older than 5 minutes", async () => {
    seedCacheFile({ fetchedAt: Date.now() - 6 * 60 * 1000, rules: [], failMode: "open" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [RULE], fail_mode: "closed" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCachedOrgConfig(CONFIG);

    expect(result).toEqual({ rules: [RULE], failMode: "closed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the stale cache (rules and fail_mode both) when a refresh fails", async () => {
    seedCacheFile({ fetchedAt: Date.now() - 6 * 60 * 1000, rules: [RULE], failMode: "closed" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await getCachedOrgConfig(CONFIG);

    expect(result).toEqual({ rules: [RULE], failMode: "closed" });
  });

  it("falls back to an empty rule set and 'open' fail_mode when there's no cache and the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await getCachedOrgConfig(CONFIG);

    expect(result).toEqual({ rules: [], failMode: "open" });
  });
});
