import { describe, expect, it } from "vitest";

import { mapToolCall } from "../src/mapping";

describe("mapToolCall", () => {
  it("maps a plain Bash command to action_type 'bash'", () => {
    const result = mapToolCall("Bash", { command: "npm install" });
    expect(result.actionType).toBe("bash");
    expect(result.actionSummary).toBe("npm install");
  });

  it("maps a git subcommand to action_type 'git'", () => {
    const result = mapToolCall("Bash", { command: "git push --force origin main" });
    expect(result.actionType).toBe("git");
  });

  it("maps Edit to action_type 'file_edit' without including file contents", () => {
    const result = mapToolCall("Edit", {
      file_path: "src/index.ts",
      old_string: "const x = 1;",
      new_string: "const x = 2;\nconst y = 3;",
    });
    expect(result.actionType).toBe("file_edit");
    expect(result.actionSummary).not.toContain("const x = 2");
    expect(result.actionSummary).toContain("src/index.ts");
  });

  it("maps Write to action_type 'file_edit'", () => {
    const result = mapToolCall("Write", { file_path: "src/new.ts", content: "a\nb\nc" });
    expect(result.actionType).toBe("file_edit");
    expect(result.payloadMeta.file_path).toBe("src/new.ts");
  });

  it("maps WebFetch to action_type 'api_call'", () => {
    const result = mapToolCall("WebFetch", { url: "https://example.com" });
    expect(result.actionType).toBe("api_call");
    expect(result.actionSummary).toContain("https://example.com");
  });

  it("maps an MCP tool to action_type 'api_call'", () => {
    const result = mapToolCall("mcp__github__create_pull_request", { owner: "acme" });
    expect(result.actionType).toBe("api_call");
    expect(result.payloadMeta.tool_name).toBe("mcp__github__create_pull_request");
  });

  it("falls back to 'api_call' for an unrecognized tool rather than dropping the event", () => {
    const result = mapToolCall("Grep", { pattern: "foo" });
    expect(result.actionType).toBe("api_call");
    expect(result.actionSummary).toContain("Grep");
  });
});
