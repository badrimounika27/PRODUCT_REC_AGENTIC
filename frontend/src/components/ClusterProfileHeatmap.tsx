import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Expand, Grid3X3, Minimize2, X } from "lucide-react";
import type { ClusterProfileColumn, ClusterProfileRow } from "../api";
import { isPercentStyleColumnId, scalePercentLikeValue } from "../lib/percentDisplay";
import { heatmapCellTextColor, heatmapIntensityColor } from "./analytics/chartTheme";

type Props = {
  columns: ClusterProfileColumn[];
  rows: ClusterProfileRow[];
  selectedClusterId?: number | null;
  onSelectCluster?: (clusterId: number) => void;
};

function fmtCell(v: number, columnId: string): string {
  if (!Number.isFinite(v)) return "—";
  const display = isPercentStyleColumnId(columnId) ? scalePercentLikeValue(v) : v;
  const a = Math.abs(display);
  if (isPercentStyleColumnId(columnId)) return display.toFixed(2);
  if (a >= 1e6) return `${(display / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(display / 1e3).toFixed(2)}k`;
  if (a < 0.0001 && a > 0) return display.toExponential(2);
  if (a < 1) return display.toFixed(4);
  if (a < 100) return display.toFixed(2);
  return display.toFixed(1);
}

export function ClusterProfileHeatmap({
  columns,
  rows,
  selectedClusterId = null,
  onSelectCluster,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const groupRuns = useMemo(() => {
    const runs: { group: string; start: number; len: number }[] = [];
    if (!columns.length) return runs;
    let g = columns[0].group;
    let start = 0;
    for (let i = 1; i <= columns.length; i++) {
      if (i === columns.length || columns[i].group !== g) {
        runs.push({ group: g, start, len: i - start });
        if (i < columns.length) {
          g = columns[i].group;
          start = i;
        }
      }
    }
    return runs;
  }, [columns]);

  const colMinMax = useMemo(() => {
    const m: Record<string, { min: number; max: number }> = {};
    for (const c of columns) {
      let min = Infinity;
      let max = -Infinity;
      for (const r of rows) {
        const v = r.values[c.id] ?? 0;
        if (!Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      if (!Number.isFinite(min) || min === max) {
        m[c.id] = { min: 0, max: 1 };
      } else {
        m[c.id] = { min, max };
      }
    }
    return m;
  }, [columns, rows]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  if (!columns.length || !rows.length) {
    return (
      <p className="text-sm text-slate-500">
        No cluster profile data — run pipeline to produce clustered_data.csv.
      </p>
    );
  }

  const table = (
    <div className={`overflow-x-auto rounded-2xl border border-surface-border/60 ${expanded ? "max-h-[calc(100vh-7rem)] overflow-y-auto" : ""}`}>
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead className="sticky top-0 z-30">
          <tr className="border-b border-slate-700/80">
            <th
              className="sticky left-0 z-40 bg-surface-card/95 px-3 py-2.5 text-left font-medium text-slate-400 backdrop-blur-sm"
              rowSpan={2}
            >
              Cluster
            </th>
            <th
              className="bg-surface-card/95 px-3 py-2.5 text-right font-medium text-slate-400 backdrop-blur-sm"
              rowSpan={2}
            >
              Count
            </th>
            {groupRuns.map((run) => (
              <th
                key={run.start}
                colSpan={run.len}
                className="border-l border-slate-700/60 bg-surface-raised/90 px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur-sm"
              >
                {run.group}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-700/80">
            {columns.map((c) => (
              <th
                key={c.id}
                className="max-w-[140px] border-l border-slate-800/80 bg-surface-card/95 px-1.5 py-2.5 text-center font-medium leading-tight text-slate-300 backdrop-blur-sm"
                title={c.label}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = selectedClusterId === r.cluster_id;
            return (
              <tr
                key={r.cluster_id}
                onClick={() => onSelectCluster?.(r.cluster_id)}
                className={`border-t border-slate-800/80 transition-colors duration-200 ${
                  onSelectCluster ? "cursor-pointer" : ""
                } ${
                  isSelected
                    ? "bg-accent/10 ring-1 ring-inset ring-accent/40"
                    : "hover:bg-surface-raised/50"
                }`}
              >
                <td
                  className={`sticky left-0 z-10 px-3 py-2 font-medium text-slate-200 backdrop-blur-sm ${
                    isSelected ? "bg-surface-card" : "bg-surface-card/95"
                  }`}
                >
                  {r.cluster_id}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                  {r.store_count.toLocaleString()}
                </td>
                {columns.map((c) => {
                  const v = r.values[c.id] ?? 0;
                  const { min, max } = colMinMax[c.id] ?? { min: 0, max: 1 };
                  const tRaw = max > min ? (v - min) / (max - min) : 0.5;
                  const t = 1 - tRaw;
                  const bg = heatmapIntensityColor(t);
                  const fg = heatmapCellTextColor(t);
                  return (
                    <td key={c.id} className="border-l border-slate-800/60 px-1 py-1 text-center">
                      <div
                        className="rounded-lg px-1.5 py-1.5 font-medium tabular-nums transition-transform duration-150 hover:scale-[1.03]"
                        style={{
                          backgroundColor: bg,
                          color: fg,
                          textShadow:
                            t > 0.35 && t < 0.72
                              ? "0 1px 2px rgba(255,255,255,0.35)"
                              : "0 1px 2px rgba(0,0,0,0.35)",
                        }}
                        title={`${c.label}: ${fmtCell(v, c.id)}`}
                      >
                        {fmtCell(v, c.id)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1 rounded-xl border border-surface-border/80 bg-surface-raised/40 p-1">
      <button
        type="button"
        className="rounded-lg bg-accent/20 p-1.5 text-accent"
        title="Grid view"
        aria-label="Grid view"
        aria-pressed="true"
      >
        <Grid3X3 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`rounded-lg p-1.5 transition ${
          expanded
            ? "bg-accent/20 text-accent"
            : "text-slate-500 hover:bg-surface-raised hover:text-slate-300"
        }`}
        title={expanded ? "Exit fullscreen" : "Expand"}
        aria-label={expanded ? "Exit fullscreen" : "Expand"}
        aria-pressed={expanded}
      >
        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[11px] leading-relaxed text-slate-500">
          Cell colors compare each metric across clusters (higher relative value = greener, lower = redder). Purchase
          frequency is 1 ÷ average days between purchases at the cluster level. Click a row to select that cluster.
        </p>
        {toolbar}
      </div>

      {table}

      {expanded && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex flex-col bg-surface/95 backdrop-blur-md"
              role="dialog"
              aria-modal="true"
              aria-label="Cluster profile heatmap fullscreen"
            >
              <div className="flex items-center justify-between gap-4 border-b border-surface-border/80 px-5 py-4 sm:px-8">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-100">Cluster profile</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Fullscreen view · press Esc to close</p>
                </div>
                <div className="flex items-center gap-2">
                  {toolbar}
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="rounded-xl border border-surface-border bg-surface-raised/60 p-2 text-slate-400 transition hover:bg-surface-raised hover:text-slate-200"
                    title="Close"
                    aria-label="Close fullscreen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-8">{table}</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
