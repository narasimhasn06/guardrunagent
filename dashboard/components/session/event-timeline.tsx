"use client";

import { useState } from "react";

import type { AgentEventOut } from "@/lib/backend";

import { ActionTag } from "./action-tag";
import { StatusBadge } from "./status-badge";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCost(value: string): string {
  return `$${Number(value).toFixed(4)}`;
}

/**
 * The flagship Session Replay timeline (docs/04-ui-ux-design.md Section
 * 3.3): one card per event, expandable to reveal the reasoning snippet
 * and metadata, with blocked/flagged events visually distinct and
 * showing the matched rule's name inline.
 *
 * `ruleNamesById` is built by the page from a separate GET /rules call --
 * agent_events only stores matched_rule_id (a UUID), not the rule's name,
 * so this joins them client-side rather than requiring a backend change
 * to embed the name in the session response.
 */
export function EventTimeline({
  events,
  ruleNamesById,
}: {
  events: AgentEventOut[];
  ruleNamesById: Map<string, string>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return <p className="page-placeholder">No events logged for this session yet.</p>;
  }

  return (
    <ol className="event-timeline">
      {events.map((event) => {
        const isExpanded = expandedId === event.id;
        const isFlaggedOrBlocked = event.status === "blocked" || event.status === "flagged";
        const ruleName = event.matched_rule_id ? ruleNamesById.get(event.matched_rule_id) : undefined;
        const hasDetail =
          Boolean(event.reasoning_snippet) || Boolean(event.payload_meta && Object.keys(event.payload_meta).length > 0);

        return (
          <li key={event.id} className={isFlaggedOrBlocked ? "event-card event-card-flagged" : "event-card"}>
            <button
              type="button"
              className="event-card-header"
              onClick={() => setExpandedId(isExpanded ? null : event.id)}
              aria-expanded={isExpanded}
            >
              <ActionTag actionType={event.action_type} />
              <span className="event-card-summary mono">{event.action_summary || "(no summary)"}</span>
              <span className="event-card-time mono">{formatTime(event.created_at)}</span>
              <span className="event-card-cost mono">{formatCost(event.cost_usd)}</span>
              <StatusBadge status={event.status} />
            </button>

            {isFlaggedOrBlocked && ruleName && (
              <p className="event-card-rule">
                {event.status === "blocked" ? "Blocked" : "Flagged"} by rule: <span className="mono">{ruleName}</span>
              </p>
            )}

            {isExpanded && (
              <div className="event-card-detail">
                {event.reasoning_snippet && <p className="event-card-reasoning">{event.reasoning_snippet}</p>}
                {event.payload_meta && Object.keys(event.payload_meta).length > 0 && (
                  <dl className="event-card-meta">
                    {Object.entries(event.payload_meta).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd className="mono">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!hasDetail && <p className="page-placeholder">No additional detail available for this event.</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
