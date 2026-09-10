import { mapToolCall } from "../mapping";
import { redactDotenvBlocks, redactText } from "../redact";
import type { QueuedEvent } from "../queue";

/**
 * Builds the (already redacted) event payload logged by PostToolUse and
 * PostToolUseFailure. Pure and testable, separate from the hook entry
 * points' stdin/queue IO.
 */
export function buildLoggedEvent(params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  status: "success" | "failure";
  toolOutputOrError?: string;
  now?: () => Date;
}): QueuedEvent {
  const mapped = mapToolCall(params.toolName, params.toolInput);

  let summary = redactText(mapped.actionSummary);
  if (typeof params.toolOutputOrError === "string") {
    summary = redactDotenvBlocks(summary);
  }

  const timestamp = (params.now ?? (() => new Date()))().toISOString();

  return {
    action_type: mapped.actionType,
    action_summary: summary,
    payload_meta: mapped.payloadMeta,
    status: params.status,
    timestamp,
  };
}
