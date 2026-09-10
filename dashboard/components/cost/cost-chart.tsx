"use client";

import { useState } from "react";

import type { LegendItem, StackedDay } from "@/lib/costBreakdown";

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
 * Bar chart per docs/04-ui-ux-design.md Section 3.4: plain daily totals
 * for the "Day" toggle, stacked by project/agent for the other two --
 * lib/costBreakdown.ts does that pivot; this only renders StackedDay[].
 *
 * Interaction is per-bar (day), not per-segment: hovering or focusing a
 * day shows every segment's value in one tooltip. That's simpler and more
 * accessible than per-segment hit targets (a 90-day x 8-series chart
 * would need 720 individually focusable elements), and arguably more
 * useful for a stacked comparison anyway.
 */
export function CostChart({ days, legend }: { days: StackedDay[]; legend: LegendItem[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (days.length === 0 || days.every((day) => day.total === 0)) {
    return <p className="page-placeholder">No spend recorded in this range.</p>;
  }

  const maxTotal = Math.max(...days.map((day) => day.total), 0.0001);
  const numDays = days.length;
  const gapPct = Math.min(1, 20 / numDays);
  const barWidthPct = 100 / numDays - gapPct;

  const yPct = (value: number) => 100 - (value / maxTotal) * 100;

  const hovered = hoveredIndex !== null ? days[hoveredIndex] : null;
  const hoveredX = hoveredIndex !== null ? (hoveredIndex * 100) / numDays + 100 / numDays / 2 : 0;

  return (
    <div className="cost-chart">
      {legend.length > 1 && (
        <div className="cost-chart-legend">
          {legend.map((item) => (
            <div key={item.key} className="cost-chart-legend-item">
              <span className="cost-chart-legend-swatch" style={{ background: item.color }} />
              <span>{item.key}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cost-chart-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="cost-chart-svg" aria-hidden="true">
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
          {days.map((day, i) => {
            const x = (i * 100) / numDays + gapPct / 2;
            let cumulative = 0;
            return (
              <g key={day.date}>
                {day.segments.map((segment) => {
                  const segTop = yPct(cumulative + segment.value);
                  const segHeight = (segment.value / maxTotal) * 100;
                  cumulative += segment.value;
                  return (
                    <rect
                      key={segment.key}
                      x={x}
                      y={segTop}
                      width={barWidthPct}
                      height={Math.max(segHeight - 0.4, 0)}
                      rx={0.8}
                      fill={segment.color}
                      opacity={hoveredIndex === null || hoveredIndex === i ? 1 : 0.5}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        <div className="cost-chart-hit-layer">
          {days.map((day, i) => (
            <button
              key={day.date}
              type="button"
              className="cost-chart-hit-target"
              style={{ left: `${(i * 100) / numDays}%`, width: `${100 / numDays}%` }}
              onMouseEnter={() => setHoveredIndex(i)}
              onFocus={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onBlur={() => setHoveredIndex(null)}
              aria-label={`${formatShortDate(day.date)}: ${
                day.segments.length > 0
                  ? day.segments.map((segment) => `${segment.key} ${formatCost(segment.value)}`).join(", ")
                  : "no spend"
              }, total ${formatCost(day.total)}`}
            />
          ))}
        </div>

        {hovered && (
          <div className="cost-chart-tooltip" style={{ left: `${hoveredX}%` }}>
            <div className="cost-chart-tooltip-date">{formatShortDate(hovered.date)}</div>
            {hovered.segments.length === 0 ? (
              <div className="page-placeholder">No spend</div>
            ) : (
              [...hovered.segments].reverse().map((segment) => (
                <div key={segment.key} className="cost-chart-tooltip-row">
                  <span className="cost-chart-tooltip-key">
                    <span className="cost-chart-legend-swatch" style={{ background: segment.color }} />
                    {segment.key}
                  </span>
                  <span className="mono">{formatCost(segment.value)}</span>
                </div>
              ))
            )}
            {hovered.segments.length > 1 && (
              <div className="cost-chart-tooltip-row cost-chart-tooltip-total">
                <span>Total</span>
                <span className="mono">{formatCost(hovered.total)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="spend-chart-axis">
        <span>{formatShortDate(days[0].date)}</span>
        <span>{formatShortDate(days[days.length - 1].date)}</span>
      </div>
    </div>
  );
}
