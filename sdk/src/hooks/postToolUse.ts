import { loadConfig, QUEUE_DIR, FAILED_EVENTS_FILE } from "../config";
import { buildLoggedEvent } from "../logic/loggedEvent";
import { enqueueAndMaybeFlush } from "../queue";
import { deriveSessionUuid } from "../sessionId";
import { debugLog } from "../debugLog";
import { readHookInput } from "./common";

interface PostToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: string;
}

async function main(): Promise<void> {
  try {
    const input = await readHookInput<PostToolUseInput>();
    const config = loadConfig();

    const event = buildLoggedEvent({
      toolName: input.tool_name,
      toolInput: input.tool_input,
      status: "success",
      toolOutputOrError: input.tool_output,
    });

    await enqueueAndMaybeFlush(deriveSessionUuid(input.session_id), event, config, {
      queueDir: QUEUE_DIR,
      failedEventsFile: FAILED_EVENTS_FILE,
    });
  } catch (err) {
    debugLog(`PostToolUse hook crashed: ${String(err)}`);
  }
  process.exit(0);
}

void main();
