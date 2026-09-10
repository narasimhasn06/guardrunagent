import { summarizeFileChange } from "./redact";

export type BackendActionType = "file_edit" | "bash" | "git" | "api_call";

export interface MappedAction {
  actionType: BackendActionType;
  actionSummary: string;
  payloadMeta: Record<string, unknown>;
}

/**
 * Maps a Claude Code tool_name/tool_input pair to the backend's action
 * taxonomy (agent_events.action_type: 'file_edit' | 'bash' | 'git' |
 * 'api_call', per docs/03-low-level-design.md Section 1). Claude Code's
 * own tool names (Bash, Edit, Write, WebFetch, mcp__*, ...) don't map 1:1
 * onto that taxonomy -- this mapping is a judgment call, not something
 * either doc specifies.
 *
 * Field names verified against Claude Code's hooks reference
 * (https://code.claude.com/docs/en/hooks.md) for Bash only: `command`,
 * `description`, `timeout`, `run_in_background`. Edit/Write/NotebookEdit's
 * exact tool_input field names were NOT independently verified against
 * primary docs -- this checks several plausible shapes defensively
 * (file_path/path with content/file_text/old_string/new_string) and is
 * flagged for confirmation against a real Claude Code session's hook
 * debug log before this ships.
 */
export function mapToolCall(toolName: string, toolInput: Record<string, unknown>): MappedAction {
  if (toolName === "Bash" || toolName === "PowerShell") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    const isGit = /^\s*git\s/.test(command);
    return {
      actionType: isGit ? "git" : "bash",
      actionSummary: command,
      payloadMeta: { command },
    };
  }

  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    const filePath = firstString(toolInput, ["file_path", "path", "notebook_path"]) ?? "unknown file";
    const newContent = firstString(toolInput, ["content", "file_text", "new_string", "new_content"]);
    const oldContent = firstString(toolInput, ["old_string", "old_content"]);
    return {
      actionType: "file_edit",
      actionSummary: summarizeFileChange({
        filePath,
        verb: toolName === "Write" ? "wrote" : "edited",
        oldContent,
        newContent,
      }),
      payloadMeta: { file_path: filePath },
    };
  }

  if (toolName === "WebFetch" || toolName === "WebSearch" || toolName.startsWith("mcp__")) {
    const url = firstString(toolInput, ["url"]);
    return {
      actionType: "api_call",
      actionSummary: url ? `${toolName}: ${url}` : toolName,
      payloadMeta: { tool_name: toolName },
    };
  }

  // Anything else (Read, Glob, Grep, ...) isn't one of the four documented
  // action_type values. Logged as 'api_call' as the closest catch-all
  // rather than dropped, so R1 ("capture every tool-call event") still
  // holds -- flagged as an approximation, not a documented mapping.
  return {
    actionType: "api_call",
    actionSummary: `${toolName} ${JSON.stringify(toolInput).slice(0, 200)}`,
    payloadMeta: { tool_name: toolName },
  };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}
