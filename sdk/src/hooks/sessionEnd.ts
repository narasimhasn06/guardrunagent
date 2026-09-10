import { loadConfig, QUEUE_DIR, FAILED_EVENTS_FILE } from "../config";
import { flushAll } from "../queue";
import { deriveSessionUuid } from "../sessionId";
import { debugLog } from "../debugLog";
import { readHookInput } from "./common";

interface SessionEndInput {
  session_id: string;
  why: "clear" | "resume" | "logout" | "prompt_input_exit" | "other";
}

/**
 * Last chance to drain this session's on-disk queue before the process
 * tree goes away. SessionEnd hooks share a tight timeout budget in Claude
 * Code (docs verified: default ~1.5s total, extendable per-hook) -- this
 * is configured with a 5s timeout in hooks/hooks.json and stays
 * best-effort: whatever doesn't make it out gets picked up by the next
 * session's flush attempts via the failed-events fallback file, or sits
 * queued until a future hook invocation for the same session_id (which
 * won't happen once the session has ended) -- so a SessionEnd flush
 * failure here is the one true data-loss risk in this design, flagged
 * rather than silently accepted.
 */
async function main(): Promise<void> {
  try {
    const input = await readHookInput<SessionEndInput>();
    const config = loadConfig();
    await flushAll(deriveSessionUuid(input.session_id), config, {
      queueDir: QUEUE_DIR,
      failedEventsFile: FAILED_EVENTS_FILE,
    });
  } catch (err) {
    debugLog(`SessionEnd hook crashed: ${String(err)}`);
  }
  process.exit(0);
}

void main();
