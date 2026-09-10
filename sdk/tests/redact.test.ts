import { describe, expect, it } from "vitest";

import { redactDotenvBlocks, redactText, summarizeFileChange } from "../src/redact";

describe("redactText", () => {
  it("strips a Stripe-style API key", () => {
    const input = "curl -H 'Authorization: Bearer sk_live_ABCDEFGHIJ1234567890'";
    expect(redactText(input)).not.toContain("sk_live_ABCDEFGHIJ1234567890");
    expect(redactText(input)).toContain("[REDACTED]");
  });

  it("strips an AWS access key id", () => {
    expect(redactText("export AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP")).not.toContain(
      "AKIAABCDEFGHIJKLMNOP"
    );
  });

  it("strips a GitHub personal access token", () => {
    const token = "ghp_" + "a".repeat(36);
    expect(redactText(`git clone https://${token}@github.com/org/repo.git`)).not.toContain(token);
  });

  it("strips an Anthropic API key", () => {
    const key = "sk-ant-" + "b".repeat(30);
    expect(redactText(`ANTHROPIC_API_KEY=${key}`)).not.toContain(key);
  });

  it("does not over-redact an ordinary command", () => {
    const command = "npm install && npm run build";
    expect(redactText(command)).toBe(command);
  });

  it("does not over-redact an ordinary file path", () => {
    const command = "cat src/index.ts";
    expect(redactText(command)).toBe(command);
  });
});

describe("redactDotenvBlocks", () => {
  it("redacts a block of dotenv-shaped output", () => {
    const output = "reading .env\nAPI_KEY=abc123\nDB_PASSWORD=hunter2\ndone";
    const result = redactDotenvBlocks(output);
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("abc123");
    expect(result).toContain("[REDACTED .env-like content]");
  });

  it("leaves a single KEY=value line alone (below the block threshold)", () => {
    const output = "some log line\nVALUE=1\nmore log output";
    expect(redactDotenvBlocks(output)).toBe(output);
  });

  it("does not touch text with no dotenv-shaped lines", () => {
    const output = "PASS src/index.test.js\n1 test passed";
    expect(redactDotenvBlocks(output)).toBe(output);
  });
});

describe("summarizeFileChange", () => {
  it("never includes the actual file contents", () => {
    const secretContent = "const password = 'super-secret-value';";
    const summary = summarizeFileChange({ filePath: "src/config.ts", verb: "wrote", newContent: secretContent });
    expect(summary).not.toContain("super-secret-value");
  });

  it("reports a line-count delta when old and new content are both known", () => {
    const summary = summarizeFileChange({
      filePath: "src/index.ts",
      verb: "edited",
      oldContent: "line1\nline2",
      newContent: "line1\nline2\nline3\nline4",
    });
    expect(summary).toBe("edited src/index.ts (2 -> 4 lines)");
  });

  it("falls back to just a line count when only new content is known", () => {
    const summary = summarizeFileChange({ filePath: "src/new.ts", verb: "wrote", newContent: "a\nb\nc" });
    expect(summary).toBe("wrote src/new.ts (3 lines)");
  });

  it("falls back to just the file path when no content is known", () => {
    expect(summarizeFileChange({ filePath: "src/x.ts", verb: "edited" })).toBe("edited src/x.ts");
  });
});
