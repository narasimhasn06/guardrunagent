import { loadConfig } from "../config";
import { getCachedOrgConfig } from "../ruleCache";
import { debugLog } from "../debugLog";
import { readHookInput } from "./common";

interface SessionStartInput {
  session_id: string;
  how: "startup" | "resume" | "clear" | "compact" | "fork";
}

/**
 * Best-effort: pre-warms the local rule + fail_mode cache so the first
 * PreToolUse invocation of the session doesn't pay the GET /rules
 * round-trip cost. Session rows themselves aren't created here -- see the
 * gap noted in backend/app/routers/events.py: POST /events auto-creates a
 * session row on first sight of an unknown session_id, since there's no
 * documented session-creation endpoint to call from here instead.
 */
async function main(): Promise<void> {
  try {
    await readHookInput<SessionStartInput>(); // drain stdin; input isn't otherwise needed
    const config = loadConfig();
    await getCachedOrgConfig(config);
  } catch (err) {
    debugLog(`SessionStart hook crashed: ${String(err)}`);
  }
  process.exit(0);
}

void main();
