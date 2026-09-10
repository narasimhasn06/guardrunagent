import { Pagination } from "@/components/sessions/pagination";
import { SessionsFilters } from "@/components/sessions/sessions-filters";
import { SessionsTable } from "@/components/sessions/sessions-table";
import {
  BackendError,
  getSessionsList,
  type SessionStatus,
  type SessionsDateRangePreset,
} from "@/lib/backend";

function isSessionStatus(value: string | undefined): value is SessionStatus {
  return value === "active" || value === "completed" || value === "error";
}

function isDateRangePreset(value: string | undefined): value is SessionsDateRangePreset {
  return value === "7d" || value === "30d";
}

interface SessionsSearchParams {
  project?: string;
  agent?: string;
  search?: string;
  status?: string;
  range?: string;
  offset?: string;
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SessionsSearchParams>;
}) {
  const params = await searchParams;
  const offset = params.offset ? Number(params.offset) || 0 : 0;

  let result;
  try {
    result = await getSessionsList({
      project: params.project,
      agent: params.agent,
      search: params.search,
      status: isSessionStatus(params.status) ? params.status : undefined,
      dateRange: isDateRangePreset(params.range) ? params.range : "all",
      offset,
    });
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Unexpected error loading sessions.";
    return (
      <div>
        <h1 className="page-title">Sessions</h1>
        <p className="login-error">Couldn&apos;t load sessions: {message}</p>
      </div>
    );
  }

  return (
    <div className="sessions-page">
      <h1 className="page-title">Sessions</h1>
      <SessionsFilters projects={result.filters.projects} agents={result.filters.agents} />
      <SessionsTable sessions={result.sessions} />
      <Pagination total={result.total_count} limit={result.limit} offset={result.offset} />
    </div>
  );
}
