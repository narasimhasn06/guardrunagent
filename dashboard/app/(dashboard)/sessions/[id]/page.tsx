import { notFound } from "next/navigation";

import { CostPanel } from "@/components/session/cost-panel";
import { EventTimeline } from "@/components/session/event-timeline";
import { SessionHeader } from "@/components/session/session-header";
import { BackendError, getRules, getSessionDetail, type RuleOut, type SessionDetailOut } from "@/lib/backend";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let session: SessionDetailOut;
  let rules: RuleOut[];

  try {
    [session, rules] = await Promise.all([getSessionDetail(id), getRules()]);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) {
      notFound();
    }
    const message = err instanceof BackendError ? err.message : "Unexpected error loading this session.";
    return (
      <div>
        <h1 className="page-title">Session {id}</h1>
        <p className="login-error">Couldn&apos;t load this session: {message}</p>
      </div>
    );
  }

  const ruleNamesById = new Map(rules.map((rule) => [rule.id, rule.name]));

  return (
    <div className="session-replay">
      <SessionHeader session={session} />

      <div className="session-replay-body">
        <EventTimeline events={session.events} ruleNamesById={ruleNamesById} />
        <CostPanel session={session} />
      </div>

      {session.event_count > session.events.length && (
        <p className="page-placeholder">
          Showing the first {session.events.length.toLocaleString()} of {session.event_count.toLocaleString()}{" "}
          events.
        </p>
      )}
    </div>
  );
}
