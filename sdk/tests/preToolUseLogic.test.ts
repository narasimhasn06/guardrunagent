import { describe, expect, it, vi } from "vitest";

import { decidePreToolUse, type PreToolUseDeps, type PreToolUseInput } from "../src/logic/preToolUseLogic";
import type { CachedRule } from "../src/matcher";

const FORCE_PUSH_RULE: CachedRule = {
  id: "rule-1",
  name: "no-force-push-main",
  pattern_type: "command_regex",
  pattern_value: "^git push --force",
  action_on_match: "block",
  enabled: true,
};

const INPUT: PreToolUseInput = {
  session_id: "abc123",
  tool_name: "Bash",
  tool_input: { command: "git push --force origin main" },
};

function makeDeps(overrides: Partial<PreToolUseDeps> = {}): PreToolUseDeps {
  return {
    config: { failMode: "open" },
    getRules: vi.fn().mockResolvedValue([FORCE_PUSH_RULE]),
    checkGuardrail: vi.fn().mockResolvedValue({ decision: "allow" }),
    ...overrides,
  };
}

describe("decidePreToolUse", () => {
  it("skips the network call entirely when no cached rule could match (fast path)", async () => {
    const checkGuardrail = vi.fn();
    const deps = makeDeps({ getRules: vi.fn().mockResolvedValue([]), checkGuardrail });

    const decision = await decidePreToolUse(
      { session_id: "abc123", tool_name: "Bash", tool_input: { command: "npm install" } },
      deps
    );

    expect(decision).toEqual({ action: "allow" });
    expect(checkGuardrail).not.toHaveBeenCalled();
  });

  it("denies the action when the backend returns 'block'", async () => {
    const deps = makeDeps({
      checkGuardrail: vi.fn().mockResolvedValue({ decision: "block", rule_name: "no-force-push-main" }),
    });

    const decision = await decidePreToolUse(INPUT, deps);

    expect(decision.action).toBe("deny");
    if (decision.action === "deny") {
      expect(decision.reason).toContain("no-force-push-main");
    }
  });

  it("allows the action through when the backend returns 'allow'", async () => {
    const deps = makeDeps({ checkGuardrail: vi.fn().mockResolvedValue({ decision: "allow" }) });
    const decision = await decidePreToolUse(INPUT, deps);
    expect(decision).toEqual({ action: "allow" });
  });

  it("allows the action through when the backend returns 'flag' -- flagging never blocks", async () => {
    const deps = makeDeps({ checkGuardrail: vi.fn().mockResolvedValue({ decision: "flag", rule_name: "review-me" }) });
    const decision = await decidePreToolUse(INPUT, deps);
    expect(decision).toEqual({ action: "allow" });
  });

  it("fails open (allows) on a guardrail-check network error when failMode is 'open'", async () => {
    const deps = makeDeps({
      config: { failMode: "open" },
      checkGuardrail: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const decision = await decidePreToolUse(INPUT, deps);
    expect(decision).toEqual({ action: "allow" });
  });

  it("fails closed (denies) on a guardrail-check network error when failMode is 'closed'", async () => {
    const deps = makeDeps({
      config: { failMode: "closed" },
      checkGuardrail: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const decision = await decidePreToolUse(INPUT, deps);
    expect(decision.action).toBe("deny");
  });

  it("redacts the action summary before sending it to the backend", async () => {
    const checkGuardrail = vi.fn().mockResolvedValue({ decision: "allow" });
    const deps = makeDeps({
      getRules: vi.fn().mockResolvedValue([{ ...FORCE_PUSH_RULE, pattern_value: "SECRET_TOKEN" }]),
      checkGuardrail,
    });

    await decidePreToolUse(
      {
        session_id: "abc123",
        tool_name: "Bash",
        tool_input: { command: "echo Bearer sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa SECRET_TOKEN" },
      },
      deps
    );

    expect(checkGuardrail).toHaveBeenCalledOnce();
    const sentSummary = checkGuardrail.mock.calls[0][0].action_summary as string;
    expect(sentSummary).not.toContain("sk-ant-");
  });
});
