export interface CachedRule {
  id: string;
  name: string;
  pattern_type: "command_regex" | "path_prefix" | "action_type";
  pattern_value: string;
  action_on_match: "block" | "flag";
  enabled: boolean;
}

/**
 * Local pre-check: does this action possibly match any cached rule?
 * Mirrors backend/app/guardrails.py's match_rule so the SDK's fast path
 * and the backend's authoritative decision agree on what "might match"
 * means. This never decides block/flag itself -- only whether it's worth
 * paying for a synchronous network round-trip to /guardrail-check
 * (docs/03-low-level-design.md Section 3.2: "only escalate to a network
 * call if a pattern *might* match, keeping the common path... fully
 * local and fast").
 */
export function mightMatchAnyRule(actionType: string, actionSummary: string, rules: CachedRule[]): boolean {
  return rules.some((rule) => {
    if (!rule.enabled) return false;

    if (rule.pattern_type === "command_regex") {
      try {
        return new RegExp(rule.pattern_value).test(actionSummary);
      } catch {
        return false; // a malformed regex in a cached rule shouldn't crash the hook
      }
    }
    if (rule.pattern_type === "path_prefix") {
      return actionSummary.includes(rule.pattern_value);
    }
    if (rule.pattern_type === "action_type") {
      return actionType === rule.pattern_value;
    }
    return false;
  });
}
