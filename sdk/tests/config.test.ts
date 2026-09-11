import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

const ENV_KEYS = ["GUARDRUNAGENT_API_KEY", "GUARDRUNAGENT_ENDPOINT", "GUARDRUNAGENT_FAIL_MODE"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.GUARDRUNAGENT_API_KEY = "test-key";
  process.env.GUARDRUNAGENT_ENDPOINT = "https://backend.example";
  delete process.env.GUARDRUNAGENT_FAIL_MODE;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loadConfig's failModeOverride", () => {
  it("is undefined when GUARDRUNAGENT_FAIL_MODE isn't set -- no local override, use the org's setting", () => {
    expect(loadConfig().failModeOverride).toBeUndefined();
  });

  it("resolves to 'closed' when GUARDRUNAGENT_FAIL_MODE=closed", () => {
    process.env.GUARDRUNAGENT_FAIL_MODE = "closed";
    expect(loadConfig().failModeOverride).toBe("closed");
  });

  it("resolves to 'open' when GUARDRUNAGENT_FAIL_MODE=open", () => {
    process.env.GUARDRUNAGENT_FAIL_MODE = "open";
    expect(loadConfig().failModeOverride).toBe("open");
  });

  it("treats an invalid value as unset rather than silently defaulting to 'open'", () => {
    process.env.GUARDRUNAGENT_FAIL_MODE = "sometimes";
    expect(loadConfig().failModeOverride).toBeUndefined();
  });
});
