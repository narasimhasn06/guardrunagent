"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { SpendByDayRow } from "@/lib/backend";

function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Single-series line chart (spend per day), per docs/04-ui-ux-design.md
 * Section 3.1 and the dataviz skill's method: one series needs no legend
 * (the card title names it), a 2px line, hairline gridlines, and a
 * crosshair+tooltip that snaps to the nearest day rather than requiring
 * the pointer to land on the 2px line itself. Hand-rolled SVG rather than
 * a charting library -- one series, no need for the dependency.
 */
export function SpendChart({ data }: { data: SpendByDayRow[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (data.length === 0) {
    return <p className="page-placeholder">No spend recorded in this range.</p>;
  }

  const values = data.map((row) => Number(row.cost_usd));
  const maxValue = Math.max(...values, 0.0001); // avoid a degenerate 0-height chart when every value is $0
  const stepX = data.length > 1 ? 100 / (data.length - 1) : 0;

  const xPct = (i: number) => (data.length > 1 ? i * stepX : 50);
  const yPct = (value: number) => 100 - (value / maxValue) * 100;

  const pathD = data.map((row, i) => `${i === 0 ? "M" : "L"} ${xPct(i)} ${yPct(Number(row.cost_usd))}`).join(" ");

  function indexFromPointer(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const relativeX = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(data.length - 1, Math.round(relativeX * (data.length - 1))));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    setHoverIndex(indexFromPointer(event.clientX));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setHoverIndex((prev) => Math.min(data.length - 1, (prev ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setHoverIndex((prev) => Math.max(0, (prev ?? data.length) - 1));
    }
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="spend-chart">
      <div
        ref={containerRef}
        className="spend-chart-hit-layer"
        role="slider"
        tabIndex={0}
        aria-label="Spend per day"
        aria-valuemin={0}
        aria-valuemax={data.length - 1}
        aria-valuenow={hoverIndex ?? data.length - 1}
        aria-valuetext={
          hovered ? `${formatShortDate(hovered.date)}: ${formatCost(Number(hovered.cost_usd))}` : undefined
        }
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        onFocus={() => setHoverIndex((prev) => prev ?? data.length - 1)}
        onBlur={() => setHoverIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="spend-chart-svg" aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1={0}
              x2={100}
              y1={g * 100}
              y2={g * 100}
              className="spend-chart-grid"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={pathD} className="spend-chart-line" fill="none" vectorEffect="non-scaling-stroke" />
          {hoverIndex !== null && (
            <line
              x1={xPct(hoverIndex)}
              x2={xPct(hoverIndex)}
              y1={0}
              y2={100}
              className="spend-chart-crosshair"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {data.map((row, i) => (
            <circle
              key={row.date}
              cx={xPct(i)}
              cy={yPct(Number(row.cost_usd))}
              r={hoverIndex === i ? 3 : 1.5}
              className="spend-chart-dot"
            />
          ))}
        </svg>

        {hovered && (
          <div
            className="spend-chart-tooltip"
            style={{ left: `${xPct(hoverIndex!)}%`, top: `${yPct(Number(hovered.cost_usd))}%` }}
          >
            <div className="spend-chart-tooltip-value mono">{formatCost(Number(hovered.cost_usd))}</div>
            <div className="spend-chart-tooltip-date">{formatShortDate(hovered.date)}</div>
          </div>
        )}
      </div>

      <div className="spend-chart-axis">
        <span>{formatShortDate(data[0].date)}</span>
        <span className="mono">{formatCost(maxValue)} max</span>
        <span>{formatShortDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}
