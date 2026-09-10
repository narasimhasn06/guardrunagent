import { describe, expect, it } from "vitest";

import { buildCsv, csvEscape } from "@/lib/csv";

describe("csvEscape", () => {
  it("leaves an ordinary value untouched", () => {
    expect(csvEscape("guardrunagent")).toBe("guardrunagent");
  });

  it("quotes a value containing a comma", () => {
    expect(csvEscape("repo,name")).toBe('"repo,name"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("joins header and rows with CRLF, comma-separated", () => {
    const csv = buildCsv(
      ["Project", "Cost (USD)"],
      [
        ["repo-a", "1.50"],
        ["repo-b", "2.00"],
      ]
    );
    expect(csv).toBe("Project,Cost (USD)\r\nrepo-a,1.50\r\nrepo-b,2.00");
  });

  it("escapes fields that need it within a row", () => {
    const csv = buildCsv(["Project"], [["repo, with a comma"]]);
    expect(csv).toBe('Project\r\n"repo, with a comma"');
  });
});
