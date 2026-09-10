import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionBadge } from "@/components/rules/action-badge";
import { ActivityLogTable } from "@/components/rules/activity-log-table";
import { ActivityPagination } from "@/components/rules/activity-pagination";
import { NewRuleForm } from "@/components/rules/new-rule-form";
import { RulesTable } from "@/components/rules/rules-table";
import { RulesTabs } from "@/components/rules/rules-tabs";
import { StarterRulesButton } from "@/components/rules/starter-rules-button";
import type { GuardrailActivityItem, RuleOut } from "@/lib/backend";

const pushMock = vi.fn();
const refreshMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  mockSearchParams = new URLSearchParams();
  vi.unstubAllGlobals();
});

function makeRule(overrides: Partial<RuleOut> = {}): RuleOut {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "no-force-push-main",
    pattern_type: "command_regex",
    pattern_value: "^git push --force",
    action_on_match: "block",
    enabled: true,
    created_at: "2026-09-10T10:00:00Z",
    ...overrides,
  };
}

function makeActivityItem(overrides: Partial<GuardrailActivityItem> = {}): GuardrailActivityItem {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    fired_at: "2026-09-10T10:00:00Z",
    rule_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    rule_name: "no-force-push-main",
    action_on_match: "block",
    session_id: "22222222-2222-2222-2222-222222222222",
    alert_sent: true,
    ...overrides,
  };
}

describe("ActionBadge", () => {
  it("renders Block for a block action", () => {
    render(<ActionBadge action="block" />);
    expect(screen.getByText("Block")).toBeInTheDocument();
  });

  it("renders Flag for a flag action", () => {
    render(<ActionBadge action="flag" />);
    expect(screen.getByText("Flag")).toBeInTheDocument();
  });
});

describe("RulesTabs", () => {
  it("marks the Rules tab selected by default", () => {
    render(<RulesTabs current="rules" />);
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Activity Log" })).toHaveAttribute("aria-selected", "false");
  });

  it("navigates to the activity log on click", async () => {
    const user = userEvent.setup();
    render(<RulesTabs current="rules" />);

    await user.click(screen.getByRole("tab", { name: "Activity Log" }));

    expect(pushMock).toHaveBeenCalledWith("/rules?tab=activity");
  });

  it("navigates back to /rules for the Rules tab", async () => {
    const user = userEvent.setup();
    render(<RulesTabs current="activity" />);

    await user.click(screen.getByRole("tab", { name: "Rules" }));

    expect(pushMock).toHaveBeenCalledWith("/rules");
  });
});

describe("RulesTable", () => {
  it("shows a placeholder when there are no rules", () => {
    render(<RulesTable rules={[]} />);
    expect(screen.getByText(/no guardrail rules yet/i)).toBeInTheDocument();
  });

  it("renders name, monospace pattern, action badge, and toggle state", () => {
    render(<RulesTable rules={[makeRule()]} />);
    expect(screen.getByText("no-force-push-main")).toBeInTheDocument();
    expect(screen.getByText("^git push --force")).toBeInTheDocument();
    expect(screen.getByText("Block")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("PATCHes the rule and refreshes when the toggle is clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makeRule({ enabled: false }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<RulesTable rules={[makeRule({ enabled: true })]} />);
    await user.click(screen.getByRole("switch"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rules/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("shows an error and stops disabling the toggle when the PATCH fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<RulesTable rules={[makeRule({ name: "my-rule" })]} />);
    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(screen.getByText(/couldn't update "my-rule"/i)).toBeInTheDocument());
    expect(screen.getByRole("switch")).toBeEnabled();
  });
});

describe("NewRuleForm", () => {
  it("starts collapsed behind the + New Rule button", () => {
    render(<NewRuleForm />);
    expect(screen.getByRole("button", { name: "+ New Rule" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("opens the form and shows all documented fields", async () => {
    const user = userEvent.setup();
    render(<NewRuleForm />);

    await user.click(screen.getByRole("button", { name: "+ New Rule" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Pattern type")).toBeInTheDocument();
    expect(screen.getByLabelText("Pattern value")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Block" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Flag" })).not.toBeChecked();
  });

  it("submits the form and POSTs the expected payload", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makeRule() });
    vi.stubGlobal("fetch", fetchMock);

    render(<NewRuleForm />);
    await user.click(screen.getByRole("button", { name: "+ New Rule" }));
    await user.type(screen.getByLabelText("Name"), "no-secrets-in-commits");
    await user.selectOptions(screen.getByLabelText("Pattern type"), "path_prefix");
    await user.type(screen.getByLabelText("Pattern value"), "/prod/");
    await user.click(screen.getByRole("radio", { name: "Flag" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rules",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "no-secrets-in-commits",
            pattern_type: "path_prefix",
            pattern_value: "/prod/",
            action_on_match: "flag",
          }),
        })
      )
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // closes and resets back to the collapsed button on success
    expect(screen.getByRole("button", { name: "+ New Rule" })).toBeInTheDocument();
  });

  it("shows an error and keeps the form open when creation fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(<NewRuleForm />);
    await user.click(screen.getByRole("button", { name: "+ New Rule" }));
    await user.type(screen.getByLabelText("Name"), "x");
    await user.type(screen.getByLabelText("Pattern value"), "y");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText(/couldn't create the rule/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("cancel collapses the form and clears it", async () => {
    const user = userEvent.setup();
    render(<NewRuleForm />);
    await user.click(screen.getByRole("button", { name: "+ New Rule" }));
    await user.type(screen.getByLabelText("Name"), "abandoned");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "+ New Rule" })).toBeInTheDocument();
  });
});

describe("StarterRulesButton", () => {
  it("enables starter rules and reports how many were added", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [makeRule(), makeRule({ id: "b" })] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StarterRulesButton />);
    await user.click(screen.getByRole("button", { name: "Enable starter rules" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/rules/starter", { method: "POST" });
    await waitFor(() => expect(screen.getByText("Added 2 starter rules.")).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reports when the starter rules were already enabled", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: [] }) }));

    render(<StarterRulesButton />);
    await user.click(screen.getByRole("button", { name: "Enable starter rules" }));

    await waitFor(() => expect(screen.getByText(/already enabled/i)).toBeInTheDocument());
  });

  it("shows an error message when the request fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    render(<StarterRulesButton />);
    await user.click(screen.getByRole("button", { name: "Enable starter rules" }));

    await waitFor(() => expect(screen.getByText(/couldn't enable starter rules/i)).toBeInTheDocument());
  });
});

describe("ActivityLogTable", () => {
  it("shows a placeholder when there is no activity", () => {
    render(<ActivityLogTable activity={[]} />);
    expect(screen.getByText(/no guardrail activity yet/i)).toBeInTheDocument();
  });

  it("renders rule name, a session link, action badge, and delivery status", () => {
    render(<ActivityLogTable activity={[makeActivityItem()]} />);
    expect(screen.getByText("no-force-push-main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View session" })).toHaveAttribute(
      "href",
      "/sessions/22222222-2222-2222-2222-222222222222"
    );
    expect(screen.getByText("Block")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("shows 'Not delivered' when the Slack alert failed", () => {
    render(<ActivityLogTable activity={[makeActivityItem({ alert_sent: false })]} />);
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
  });

  it("shows a deleted-rule placeholder when rule_name is null", () => {
    render(<ActivityLogTable activity={[makeActivityItem({ rule_name: null, action_on_match: null })]} />);
    expect(screen.getByText("Deleted rule")).toBeInTheDocument();
  });
});

describe("ActivityPagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<ActivityPagination total={10} limit={50} offset={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("navigates forward while preserving the activity tab", async () => {
    const user = userEvent.setup();
    render(<ActivityPagination total={120} limit={50} offset={0} />);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(pushMock).toHaveBeenCalledWith("/rules?tab=activity&offset=50");
  });
});
