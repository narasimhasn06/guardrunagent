import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "@/components/sessions/pagination";
import { SessionsFilters } from "@/components/sessions/sessions-filters";
import { SessionsTable } from "@/components/sessions/sessions-table";
import type { SessionListItem } from "@/lib/backend";

const pushMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  pushMock.mockClear();
  mockSearchParams = new URLSearchParams();
});

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    agent_name: "claude-code",
    project_label: "guardrunagent",
    started_at: "2026-09-10T10:00:00Z",
    ended_at: "2026-09-10T10:05:30Z",
    total_cost_usd: "0.5000",
    total_tokens: 1200,
    status: "completed",
    event_count: 8,
    ...overrides,
  };
}

describe("SessionsTable", () => {
  it("shows a placeholder when there are no sessions", () => {
    render(<SessionsTable sessions={[]} />);
    expect(screen.getByText(/no sessions match/i)).toBeInTheDocument();
  });

  it("renders all seven documented columns for a session", () => {
    render(<SessionsTable sessions={[makeSession()]} />);
    expect(screen.getByText("guardrunagent")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("5m 30s")).toBeInTheDocument();
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("shows 'In progress' for a session with no ended_at", () => {
    render(<SessionsTable sessions={[makeSession({ ended_at: null })]} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("links the Started At cell to the session detail page", () => {
    render(<SessionsTable sessions={[makeSession({ id: "session-xyz" })]} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/sessions/session-xyz");
  });

  it("navigates to the session on row click", async () => {
    const user = userEvent.setup();
    render(<SessionsTable sessions={[makeSession({ id: "session-xyz" })]} />);

    // Click a cell that isn't the link itself, to confirm the *row* click handler works.
    await user.click(screen.getByText("claude-code"));

    expect(pushMock).toHaveBeenCalledWith("/sessions/session-xyz");
  });
});

describe("Pagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pagination total={10} limit={50} offset={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the correct range summary", () => {
    render(<Pagination total={120} limit={50} offset={50} />);
    expect(screen.getByText("51-100 of 120")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last page", () => {
    render(<Pagination total={120} limit={50} offset={0} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next once the last page is reached", () => {
    render(<Pagination total={120} limit={50} offset={100} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("navigates forward by one page's worth of offset on Next", async () => {
    const user = userEvent.setup();
    render(<Pagination total={120} limit={50} offset={0} />);

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(pushMock).toHaveBeenCalledWith("/sessions?offset=50");
  });

  it("clears the offset param entirely when paging back to the first page", async () => {
    const user = userEvent.setup();
    render(<Pagination total={120} limit={50} offset={50} />);

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(pushMock).toHaveBeenCalledWith("/sessions?");
  });
});

describe("SessionsFilters", () => {
  it("submitting the search box sets the search param and resets pagination", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("offset=50");
    render(<SessionsFilters projects={["repo-a"]} agents={["claude-code"]} />);

    const input = screen.getByPlaceholderText(/search by project/i);
    await user.type(input, "guard{Enter}");

    expect(pushMock).toHaveBeenCalledWith("/sessions?search=guard");
  });

  it("selecting a project updates the project param", async () => {
    const user = userEvent.setup();
    render(<SessionsFilters projects={["repo-a", "repo-b"]} agents={[]} />);

    await user.selectOptions(screen.getByLabelText(/filter by project/i), "repo-b");

    expect(pushMock).toHaveBeenCalledWith("/sessions?project=repo-b");
  });

  it("selecting 'All projects' clears the project param", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("project=repo-a");
    render(<SessionsFilters projects={["repo-a"]} agents={[]} />);

    await user.selectOptions(screen.getByLabelText(/filter by project/i), "");

    expect(pushMock).toHaveBeenCalledWith("/sessions?");
  });

  it("offers exactly the session-level statuses, not the event-level ones", () => {
    render(<SessionsFilters projects={[]} agents={[]} />);
    const select = screen.getByLabelText(/filter by status/i);
    const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionLabels).toEqual(["All statuses", "Active", "Completed", "Error"]);
  });
});
