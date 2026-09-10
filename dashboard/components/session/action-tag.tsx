import type { ActionType } from "@/lib/backend";

// Text tags rather than icon glyphs/emoji -- guaranteed to render
// identically everywhere, and fits the monospace-for-code-things
// direction in docs/04-ui-ux-design.md Section 5.
const LABELS: Record<ActionType, string> = {
  file_edit: "EDIT",
  bash: "BASH",
  git: "GIT",
  api_call: "API",
};

export function ActionTag({ actionType }: { actionType: ActionType }) {
  return (
    <span className={`action-tag action-tag-${actionType.replace("_", "-")} mono`}>
      {LABELS[actionType]}
    </span>
  );
}
