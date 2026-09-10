"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { SessionsDateRangePreset, SessionStatus } from "@/lib/backend";

const STATUS_OPTIONS: { value: SessionStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Error" },
];

const DATE_RANGE_OPTIONS: { value: SessionsDateRangePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/**
 * Filters row per docs/04-ui-ux-design.md Section 3.2: "Project dropdown,
 * Agent dropdown, Date range, Status" plus a free-text project-label
 * search box. All state lives in the URL so filters, search, and sort
 * stay bookmarkable/shareable and the Server Component page re-fetches
 * against them -- same approach as Home's date range.
 */
export function SessionsFilters({ projects, agents }: { projects: string[]; agents: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("search") ?? "");

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("offset"); // any filter change resets pagination
    router.push(`/sessions?${params.toString()}`);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParam("search", searchValue);
  }

  return (
    <div className="sessions-filters">
      <form onSubmit={handleSearchSubmit} className="sessions-search-form">
        <input
          type="search"
          placeholder="Search by project"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="sessions-search-input"
          aria-label="Search by project"
        />
      </form>

      <select
        value={searchParams.get("project") ?? ""}
        onChange={(event) => updateParam("project", event.target.value)}
        aria-label="Filter by project"
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project} value={project}>
            {project}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("agent") ?? ""}
        onChange={(event) => updateParam("agent", event.target.value)}
        aria-label="Filter by agent"
      >
        <option value="">All agents</option>
        {agents.map((agent) => (
          <option key={agent} value={agent}>
            {agent}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("status") ?? ""}
        onChange={(event) => updateParam("status", event.target.value)}
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("range") ?? "all"}
        onChange={(event) => updateParam("range", event.target.value === "all" ? "" : event.target.value)}
        aria-label="Filter by date range"
      >
        {DATE_RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
