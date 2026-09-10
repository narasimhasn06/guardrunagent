import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CostDateRangeSelect } from "@/components/cost/cost-date-range-select";
import { CostTable } from "@/components/cost/cost-table";
import { ExportCsvButton } from "@/components/cost/export-csv-button";
import { GroupByToggle } from "@/components/cost/group-by-toggle";
import { SpendSummary } from "@/components/cost/spend-summary";
import type { CostSummaryRow } from "@/lib/backend";

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

describe("GroupByToggle", () => {
  it("navigates with the selected group_by and highlights the current one", async () => {
    const user = userEvent.setup();
    render(<GroupByToggle current="day" />);

    expect(screen.getByRole("button", { name: "Day" })).toHaveClass("active");

    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(pushMock).toHaveBeenCalledWith("/cost?group_by=project");
  });
});

describe("CostDateRangeSelect", () => {
  it("navigates with the selected range preset", async () => {
    const user = userEvent.setup();
    render(<CostDateRangeSelect current="30d" />);

    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveClass("active");

    await user.click(screen.getByRole("button", { name: "Last 90 days" }));
    expect(pushMock).toHaveBeenCalledWith("/cost?range=90d");
  });
});

describe("SpendSummary", () => {
  it("shows no delta when there was no spend in the previous period", () => {
    render(<SpendSummary current={100} previous={0} />);
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument();
  });

  it("shows an upward change with an up arrow", () => {
    render(<SpendSummary current={150} previous={100} />);
    expect(screen.getByText("▲ 50.0% vs previous period")).toBeInTheDocument();
  });

  it("shows a downward change with a down arrow", () => {
    render(<SpendSummary current={50} previous={100} />);
    expect(screen.getByText("▼ 50.0% vs previous period")).toBeInTheDocument();
  });
});

describe("CostTable", () => {
  const rows: CostSummaryRow[] = [
    { group_key: "repo-a", total_cost_usd: "1.00", total_tokens: 500, event_count: 3 },
    { group_key: "repo-b", total_cost_usd: "5.00", total_tokens: 100, event_count: 9 },
  ];

  it("shows a placeholder when there are no rows", () => {
    render(<CostTable rows={[]} groupLabel="Project" />);
    expect(screen.getByText(/no spend recorded/i)).toBeInTheDocument();
  });

  it("defaults to sorting by cost, descending", () => {
    render(<CostTable rows={rows} groupLabel="Project" />);
    const cells = screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(cells[0]).toContain("repo-b"); // $5.00, higher cost, listed first
    expect(cells[1]).toContain("repo-a");
  });

  it("reverses direction when the same column header is clicked again", async () => {
    const user = userEvent.setup();
    render(<CostTable rows={rows} groupLabel="Project" />);

    await user.click(screen.getByRole("button", { name: /cost/i }));

    const cells = screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(cells[0]).toContain("repo-a"); // now ascending -- lower cost first
  });

  it("sorts by a different column when its header is clicked", async () => {
    const user = userEvent.setup();
    render(<CostTable rows={rows} groupLabel="Project" />);

    await user.click(screen.getByRole("button", { name: "Project" }));

    const cells = screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(cells[0]).toContain("repo-b"); // alphabetically-descending default direction on a new column
  });
});

describe("ExportCsvButton", () => {
  it("is disabled when there is nothing to export", () => {
    render(<ExportCsvButton rows={[]} groupLabel="Project" filename="export.csv" />);
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  });

  it("triggers a download with the given filename when clicked", async () => {
    const user = userEvent.setup();
    const rows: CostSummaryRow[] = [
      { group_key: "repo-a", total_cost_usd: "1.00", total_tokens: 500, event_count: 3 },
    ];

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportCsvButton rows={rows} groupLabel="Project" filename="guardrunagent-cost.csv" />);
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
