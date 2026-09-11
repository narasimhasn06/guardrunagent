import { loadConfig } from "../config";
import { postJson } from "../httpClient";
import { decidePreToolUse, type GuardrailCheckResult, type PreToolUseInput } from "../logic/preToolUseLogic";
import { getCachedOrgConfig } from "../ruleCache";
import { debugLog } from "../debugLog";
import { readHookInput } from "./common";

/**
 * Thin IO wrapper around logic/preToolUseLogic.ts's decidePreToolUse --
 * reads the PreToolUse JSON from stdin, resolves config, calls the pure
 * decision function, and writes the hookSpecificOutput JSON Claude Code
 * expects (per https://code.claude.com/docs/en/hooks.md).
 */
async function main(): Promise<void> {
  try {
    const input = await readHookInput<PreToolUseInput>();
    const config = loadConfig();
    const orgConfig = await getCachedOrgConfig(config);
    // config.ts's local override (env var / config.json), when explicitly
    // set, wins over the org-level fail_mode fetched with the rules.
    const failMode = config.failModeOverride ?? orgConfig.failMode;

    const decision = await decidePreToolUse(input, {
      config: { failMode },
      getRules: async () => orgConfig.rules,
      checkGuardrail: async (payload) => {
        const response = await postJson(config, "/guardrail-check", payload);
        if (!response.ok) throw new Error(`guardrail-check returned ${response.status}`);
        return (await response.json()) as GuardrailCheckResult;
      },
      onError: debugLog,
    });

    if (decision.action === "deny") {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        })
      );
    }
    // "allow" -> no stdout needed; exit 0 with no JSON lets the normal
    // permission flow apply.
  } catch (err) {
    // Never let an SDK bug block the user's own work -- fail open, log,
    // and exit cleanly.
    debugLog(`PreToolUse hook crashed: ${String(err)}`);
  }
  process.exit(0);
}

void main();
