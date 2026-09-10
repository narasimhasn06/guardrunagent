// Client-side redaction, per docs/03-low-level-design.md Section 3.4:
// payloads must already be safe by the time they leave the customer's
// machine. Heuristic regex matching -- aims to catch common secret
// formats, not guarantee zero false negatives (docs/06-test-plan.md
// Section 3.1 explicitly scopes this to "strips API-key-shaped strings").

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bghp_[A-Za-z0-9]{36}\b/g, // GitHub personal access token
  /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g, // Anthropic API key
  /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/gi, // generic bearer token
];

const REDACTED = "[REDACTED]";

/** Strips secret-shaped substrings from a command or output string. */
export function redactText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

const DOTENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;

/**
 * Blanks blocks of text that look like dotenv file contents (multiple
 * consecutive KEY=value lines) -- e.g. from a command like `cat .env`
 * echoing its contents into tool output. Per Section 3.4's "strips .env
 * file contents." A block heuristic rather than a filename check, since
 * this operates on output text, not file paths.
 */
export function redactDotenvBlocks(text: string, minConsecutiveLines = 2): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (DOTENV_LINE.test(lines[i])) {
      let j = i;
      while (j < lines.length && DOTENV_LINE.test(lines[j])) j++;
      if (j - i >= minConsecutiveLines) {
        out.push("[REDACTED .env-like content]");
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * File edit events must never include full file contents (NFR4) -- only
 * a path and a line-count delta.
 */
export function summarizeFileChange(params: {
  filePath: string;
  verb: "edited" | "wrote";
  oldContent?: string;
  newContent?: string;
}): string {
  const { filePath, verb, oldContent, newContent } = params;
  if (newContent === undefined) {
    return `${verb} ${filePath}`;
  }
  const newLines = countLines(newContent);
  if (oldContent === undefined) {
    return `${verb} ${filePath} (${newLines} lines)`;
  }
  return `${verb} ${filePath} (${countLines(oldContent)} -> ${newLines} lines)`;
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}
