import { mapToolCall } from "../mapping";
import { mightMatchAnyRule, type CachedRule } from "../matcher";
import { redactText } from "../redact";
import { deriveSessionUuid } from "../sessionId";

export interface PreToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export type PreToolUseDecision = { action: "allow" } | { action: "deny"; reason: string };

export interface GuardrailCheckResult {
  decision: "allow" | "block" | "flag";
  rule_name?: string | null;
}

export interface PreToolUseDeps {
  config: { failMode: "open" | "closed" };
  getRules: () => Promise<CachedRule[]>;
  checkGuardrail: (payload: {
    session_id: string;
    action_type: string;
    action_summary: string;
  }) => Promise<GuardrailCheckResult>;
  onError?: (message: string) => void;
}

/**
 * Pure decision function for the PreToolUse hook: given the tool call and
 * injected dependencies (rule cache lookup, guardrail-check network call),
 * decides allow vs deny. Kept free of stdin/stdout/process.exit so it's
 * unit-testable directly -- see hooks/preToolUse.ts for the thin IO
 * wrapper that Claude Code actually invokes.
 *
 * Note: Claude Code's PreToolUse only supports permissionDecision
 * "allow"/"deny" (verified against https://code.claude.com/docs/en/
 * hooks.md -- there is no native "flag"). The backend's 'flag' decision
 * therefore maps to "allow" here: the action proceeds, and gets logged
 * with status "flagged" by the PostToolUse hook for review in the
 * dashboard, rather than being surfaced as a distinct in-session signal.
 */
export async function decidePreToolUse(input: PreToolUseInput, deps: PreToolUseDeps): Promise<PreToolUseDecision> {
  const mapped = mapToolCall(input.tool_name, input.tool_input);
  const redactedSummary = redactText(mapped.actionSummary);

  const rules = await deps.getRules();
  if (!mightMatchAnyRule(mapped.actionType, redactedSummary, rules)) {
    return { action: "allow" }; // fast path: no network round-trip for harmless actions
  }

  try {
    const result = await deps.checkGuardrail({
      session_id: deriveSessionUuid(input.session_id),
      action_type: mapped.actionType,
      action_summary: redactedSummary,
    });
    if (result.decision === "block") {
      return { action: "deny", reason: `Blocked by rule: ${result.rule_name ?? "unknown"}` };
    }
    return { action: "allow" }; // 'allow' and 'flag' both let the action proceed
  } catch (err) {
    deps.onError?.(`guardrail-check network call failed: ${String(err)}`);
    // Fail-open vs fail-closed: docs/05-architecture-document.md Section 8
    // requires this to be configurable; there's no backend setting for it
    // yet (see app/config.ts's `failMode` for the client-side gap-fill).
    if (deps.config.failMode === "closed") {
      return { action: "deny", reason: "GuardrunAgent backend unreachable; failing closed per configuration" };
    }
    return { action: "allow" };
  }
}
