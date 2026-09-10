export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div>
      <h1 className="page-title">Session {id}</h1>
      <p className="page-placeholder">
        Session Replay view (GET /sessions/:id, event timeline) is built in a later step.
      </p>
    </div>
  );
}
