import { describe, expect, it } from "vitest";

import { mightMatchAnyRule, type CachedRule } from "../src/matcher";

const FORCE_PUSH_RULE: CachedRule = {
  id: "rule-1",
  name: "no-force-push-main",
  pattern_type: "command_regex",
  pattern_value: "^git push --force",
  action_on_match: "block",
  enabled: true,
};

const PROTECTED_PATH_RULE: CachedRule = {
  id: "rule-2",
  name: "no-prod-edits",
  pattern_type: "path_prefix",
  pattern_value: "/prod/",
  action_on_match: "flag",
  enabled: true,
};

const ACTION_TYPE_RULE: CachedRule = {
  id: "rule-3",
  name: "flag-api-calls",
  pattern_type: "action_type",
  pattern_value: "api_call",
  action_on_match: "flag",
  enabled: true,
};

describe("mightMatchAnyRule", () => {
  it("matches a command_regex rule", () => {
    expect(mightMatchAnyRule("bash", "git push --force origin main", [FORCE_PUSH_RULE])).toBe(true);
  });

  it("does not match when the command_regex pattern doesn't apply", () => {
    expect(mightMatchAnyRule("bash", "npm install", [FORCE_PUSH_RULE])).toBe(false);
  });

  it("command_regex matching is case sensitive", () => {
    expect(mightMatchAnyRule("bash", "GIT PUSH --FORCE origin main", [FORCE_PUSH_RULE])).toBe(false);
  });

  it("matches a path_prefix rule", () => {
    expect(mightMatchAnyRule("file_edit", "edited /prod/config.yaml", [PROTECTED_PATH_RULE])).toBe(true);
  });

  it("does not match a path_prefix rule for an unrelated path", () => {
    expect(mightMatchAnyRule("file_edit", "edited /staging/config.yaml", [PROTECTED_PATH_RULE])).toBe(false);
  });

  it("matches an action_type rule", () => {
    expect(mightMatchAnyRule("api_call", "WebFetch: https://example.com", [ACTION_TYPE_RULE])).toBe(true);
  });

  it("skips a disabled rule", () => {
    const disabled = { ...FORCE_PUSH_RULE, enabled: false };
    expect(mightMatchAnyRule("bash", "git push --force origin main", [disabled])).toBe(false);
  });

  it("returns false for an empty rule set", () => {
    expect(mightMatchAnyRule("bash", "rm -rf /", [])).toBe(false);
  });

  it("does not crash on a malformed regex pattern", () => {
    const malformed: CachedRule = { ...FORCE_PUSH_RULE, pattern_value: "(unterminated" };
    expect(mightMatchAnyRule("bash", "git push --force", [malformed])).toBe(false);
  });

  it("matches if any rule in a mixed set matches", () => {
    expect(mightMatchAnyRule("file_edit", "edited /prod/secrets.env", [FORCE_PUSH_RULE, PROTECTED_PATH_RULE])).toBe(
      true
    );
  });
});
