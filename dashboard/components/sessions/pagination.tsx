"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function Pagination({ total, limit, offset }: { total: number; limit: number; offset: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (total <= limit) return null;

  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  function goTo(newOffset: number) {
    const params = new URLSearchParams(searchParams);
    if (newOffset > 0) {
      params.set("offset", String(newOffset));
    } else {
      params.delete("offset");
    }
    router.push(`/sessions?${params.toString()}`);
  }

  return (
    <div className="pagination">
      <span className="pagination-summary mono">
        {start}-{end} of {total.toLocaleString()}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn" disabled={!hasPrev} onClick={() => goTo(Math.max(0, offset - limit))}>
          Previous
        </button>
        <button type="button" className="btn" disabled={!hasNext} onClick={() => goTo(offset + limit)}>
          Next
        </button>
      </div>
    </div>
  );
}
