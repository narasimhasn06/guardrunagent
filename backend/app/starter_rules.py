"""The pre-built starter rule set from docs/04-ui-ux-design.md Section 3.5:
"no force-push to main, no rm -rf, no edits to /prod or .env paths."

That's phrased as one clause covering protected paths, but
guardrail_rules.pattern_value holds a single string per rule (no list),
so "/prod" and ".env" are split into two separate rules here -- the
natural fit for the schema, still within the doc's "3-5 pre-built
rules" sizing.

Patterns favor simplicity over precision, consistent with
docs/02-high-level-design.md's "small, curated set... not a full policy
DSL" stance: e.g. the force-push pattern matches `--force` combined with
a push to `main` in either token order, not a strict grammar of every
valid git invocation.
"""

STARTER_RULES: list[dict[str, str]] = [
    {
        "name": "no-force-push-main",
        "pattern_type": "command_regex",
        "pattern_value": r"^git push .*--force.*main|^git push .*main.*--force",
        "action_on_match": "block",
    },
    {
        "name": "no-rm-rf",
        "pattern_type": "command_regex",
        "pattern_value": r"^rm -rf",
        "action_on_match": "block",
    },
    {
        "name": "no-prod-edits",
        "pattern_type": "path_prefix",
        "pattern_value": "/prod/",
        "action_on_match": "block",
    },
    {
        "name": "no-env-edits",
        "pattern_type": "path_prefix",
        "pattern_value": ".env",
        "action_on_match": "block",
    },
]
