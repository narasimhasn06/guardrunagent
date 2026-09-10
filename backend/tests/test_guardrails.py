"""Unit tests for app.guardrails.match_rule.

Cases per docs/06-test-plan.md Section 3.2 ("POST /guardrail-check"):
- Correct rule match returns the right decision and rule ID
- No rule match returns allow (== None here; the router maps that to "allow")
- Disabled rules are never matched
- Latency stays under 200ms for a realistic rule set size (20+ rules)
"""

from __future__ import annotations

import time

from app.guardrails import match_rule

RULE_NO_FORCE_PUSH = {
    "id": "rule-1",
    "name": "no-force-push-main",
    "pattern_type": "command_regex",
    "pattern_value": r"^git push --force",
    "action_on_match": "block",
    "enabled": True,
}
RULE_NO_RM_RF = {
    "id": "rule-2",
    "name": "no-rm-rf",
    "pattern_type": "command_regex",
    "pattern_value": r"^rm -rf",
    "action_on_match": "block",
    "enabled": True,
}
RULE_PROTECTED_PATH = {
    "id": "rule-3",
    "name": "no-prod-edits",
    "pattern_type": "path_prefix",
    "pattern_value": "/prod/",
    "action_on_match": "flag",
    "enabled": True,
}
RULE_ACTION_TYPE = {
    "id": "rule-4",
    "name": "flag-all-api-calls",
    "pattern_type": "action_type",
    "pattern_value": "api_call",
    "action_on_match": "flag",
    "enabled": True,
}


def test_command_regex_match_returns_the_rule():
    result = match_rule(
        action_type="bash",
        action_summary="git push --force origin main",
        rules=[RULE_NO_FORCE_PUSH, RULE_NO_RM_RF],
    )
    assert result is not None
    assert result["id"] == "rule-1"
    assert result["action_on_match"] == "block"


def test_command_regex_no_match():
    result = match_rule(
        action_type="bash",
        action_summary="npm install",
        rules=[RULE_NO_FORCE_PUSH, RULE_NO_RM_RF],
    )
    assert result is None


def test_command_regex_is_case_sensitive():
    result = match_rule(
        action_type="bash",
        action_summary="GIT PUSH --FORCE origin main",
        rules=[RULE_NO_FORCE_PUSH],
    )
    assert result is None


def test_path_prefix_match():
    result = match_rule(
        action_type="file_edit",
        action_summary="edited /prod/config.yaml",
        rules=[RULE_PROTECTED_PATH],
    )
    assert result is not None
    assert result["id"] == "rule-3"


def test_path_prefix_no_match():
    result = match_rule(
        action_type="file_edit",
        action_summary="edited /staging/config.yaml",
        rules=[RULE_PROTECTED_PATH],
    )
    assert result is None


def test_action_type_match():
    result = match_rule(action_type="api_call", action_summary=None, rules=[RULE_ACTION_TYPE])
    assert result is not None
    assert result["id"] == "rule-4"


def test_no_rules_returns_none():
    result = match_rule(action_type="bash", action_summary="rm -rf /", rules=[])
    assert result is None


def test_disabled_rule_is_never_matched():
    disabled_rule = {**RULE_NO_RM_RF, "enabled": False}
    result = match_rule(action_type="bash", action_summary="rm -rf /", rules=[disabled_rule])
    assert result is None


def test_first_match_wins_in_rule_order():
    generic = {**RULE_ACTION_TYPE, "id": "generic", "pattern_value": "bash"}
    specific = {**RULE_NO_RM_RF, "id": "specific"}
    result = match_rule(action_type="bash", action_summary="rm -rf /", rules=[generic, specific])
    assert result["id"] == "generic"  # first rule in the list wins, regardless of specificity


def test_evaluation_of_realistic_rule_set_is_well_under_200ms():
    # NFR / test-plan target is p99 < 200ms end-to-end (including the DB
    # round trip); this isolates just the in-memory evaluation cost, which
    # is what app/guardrails.py actually controls.
    rules = [
        {
            "id": f"rule-{i}",
            "name": f"rule-{i}",
            "pattern_type": "command_regex",
            "pattern_value": rf"^never-matches-{i}",
            "action_on_match": "block",
            "enabled": True,
        }
        for i in range(25)
    ]

    start = time.perf_counter()
    for _ in range(100):
        match_rule(action_type="bash", action_summary="npm install", rules=rules)
    elapsed_ms = (time.perf_counter() - start) / 100 * 1000

    assert elapsed_ms < 200
