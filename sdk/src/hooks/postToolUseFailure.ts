import { loadConfig, QUEUE_DIR, FAILED_EVENTS_FILE } from "../config";
import { buildLoggedEvent } from "../logic/loggedEvent";
import { enqueueAndMaybeFlush } from "../queue";
import { deriveSessionUuid } from "../sessionId";
import { debugLog } from "../debugLog";
import { readHookInput } from "./common";

interface PostToolUseFailureInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_error?: string;
}

async function main(): Promise<void> {
  try {
    const input = await readHookInput<PostToolUseFailureInput>();
    const config = loadConfig();

    const event = buildLoggedEvent({
      toolName: input.tool_name,
      toolInput: input.tool_input,
      status: "failure",
      toolOutputOrError: input.tool_error,
    });

    await enqueueAndMaybeFlush(deriveSessionUuid(input.session_id), event, config, {
      queueDir: QUEUE_DIR,
      failedEventsFile: FAILED_EVENTS_FILE,
    });
  } catch (err) {
    debugLog(`PostToolUseFailure hook crashed: ${String(err)}`);
  }
  process.exit(0);
}

void main();
