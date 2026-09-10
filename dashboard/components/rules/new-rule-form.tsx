"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { RuleCreateIn } from "@/lib/backend";

const PATTERN_TYPE_OPTIONS: { value: RuleCreateIn["pattern_type"]; label: string; placeholder: string }[] = [
  { value: "command_regex", label: "Command pattern", placeholder: "e.g. ^git push --force" },
  { value: "path_prefix", label: "File path", placeholder: "e.g. /prod/" },
  { value: "action_type", label: "Action type", placeholder: "e.g. bash" },
];

/** "+ New Rule" form per docs/04-ui-ux-design.md Section 3.5: Name, Pattern
 * type (dropdown), Pattern value (with example placeholder), Action on
 * match (Block/Flag radio), Save. Collapsed behind the "+ New Rule" button
 * until opened. */
export function NewRuleForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [patternType, setPatternType] = useState<RuleCreateIn["pattern_type"]>("command_regex");
  const [patternValue, setPatternValue] = useState("");
  const [action, setAction] = useState<RuleCreateIn["action_on_match"]>("block");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholder = PATTERN_TYPE_OPTIONS.find((option) => option.value === patternType)!.placeholder;

  function reset() {
    setName("");
    setPatternType("command_regex");
    setPatternValue("");
    setAction("block");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pattern_type: patternType,
          pattern_value: patternValue,
          action_on_match: action,
        } satisfies RuleCreateIn),
      });
      if (!response.ok) throw new Error();
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't create the rule — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        + New Rule
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="new-rule-form">
      <div className="new-rule-form-field">
        <label className="login-label" htmlFor="new-rule-name">
          Name
        </label>
        <input
          id="new-rule-name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="new-rule-form-field">
        <label className="login-label" htmlFor="new-rule-pattern-type">
          Pattern type
        </label>
        <select
          id="new-rule-pattern-type"
          value={patternType}
          onChange={(event) => setPatternType(event.target.value as RuleCreateIn["pattern_type"])}
        >
          {PATTERN_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="new-rule-form-field">
        <label className="login-label" htmlFor="new-rule-pattern-value">
          Pattern value
        </label>
        <input
          id="new-rule-pattern-value"
          type="text"
          required
          placeholder={placeholder}
          value={patternValue}
          onChange={(event) => setPatternValue(event.target.value)}
          className="mono"
        />
      </div>

      <fieldset className="new-rule-form-field">
        <legend className="login-label">Action on match</legend>
        <label className="new-rule-form-radio">
          <input
            type="radio"
            name="action_on_match"
            value="block"
            checked={action === "block"}
            onChange={() => setAction("block")}
          />
          Block
        </label>
        <label className="new-rule-form-radio">
          <input
            type="radio"
            name="action_on_match"
            value="flag"
            checked={action === "flag"}
            onChange={() => setAction("flag")}
          />
          Flag
        </label>
      </fieldset>

      {error && <p className="login-error">{error}</p>}

      <div className="new-rule-form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
