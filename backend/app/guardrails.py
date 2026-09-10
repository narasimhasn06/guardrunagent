from __future__ import annotations

import re
from typing import Any


def match_rule(
    *, action_type: str, action_summary: str | None, rules: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """First-match-wins evaluation over a small, per-org rule set.

    docs/03-low-level-design.md Section 4.2: "a simple ordered loop over
    rules is sufficient" at this scale, no rules-engine library needed.
    Rules are evaluated in the order given by the caller (created_at
    ascending, i.e. insertion order) -- the LLD doesn't define an explicit
    priority/ordering column.

    pattern_type handling:
    - 'command_regex': re.search against action_summary.
    - 'path_prefix': substring check against action_summary. The
      documented guardrail-check request (Section 4.2) has only
      action_type/action_summary -- no dedicated file-path field -- so
      there's nothing more structured to match a path against.
    - 'action_type': exact match against the request's action_type.
    """
    text = action_summary or ""

    for rule in rules:
        if not rule.get("enabled", True):
            continue

        pattern_type = rule["pattern_type"]
        pattern_value = rule["pattern_value"]

        if pattern_type == "command_regex":
            matched = re.search(pattern_value, text) is not None
        elif pattern_type == "path_prefix":
            matched = pattern_value in text
        elif pattern_type == "action_type":
            matched = action_type == pattern_value
        else:
            matched = False

        if matched:
            return rule

    return None
