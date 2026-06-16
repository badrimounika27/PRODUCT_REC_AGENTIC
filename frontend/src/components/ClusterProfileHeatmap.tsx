import { useMemo } from "react";
import type { ClusterProfileColumn, ClusterProfileRow } from "../api";
import { isPercentStyleColumnId, scalePercentLikeValue } from "../lib/percentDisplay";
import { heatmapCellTextColor, heatmapIntensityColor } from "./analytics/chartTheme";

type Props = {
  columns: ClusterProfileColumn[];
  rows: ClusterProfileRow[];
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

export function ClusterProfileHeatmap({ columns, rows }: Props) {
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

  if (!columns.length || !rows.length) {
    return (
      <p className="text-sm text-slate-500">
        No cluster profile data — run pipeline to produce clustered_data.csv.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <p className="mb-3 text-[11px] text-slate-500">
        Cell colors compare each metric across clusters (higher relative value = greener, lower = redder). Purchase
        frequency is 1 ÷ average days between purchases at the cluster level.
      </p>
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-700">
            <th
              className="sticky left-0 z-20 bg-slate-900/95 px-2 py-2 text-left font-medium text-slate-400"
              rowSpan={2}
            >
              Cluster
            </th>
            <th className="bg-slate-900/95 px-2 py-2 text-right font-medium text-slate-400" rowSpan={2}>
              Count
            </th>
            {groupRuns.map((run) => (
              <th
                key={run.start}
                colSpan={run.len}
                className="border-l border-slate-700 bg-slate-800/90 px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {run.group}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-700">
            {columns.map((c) => (
              <th
                key={c.id}
                className="max-w-[140px] border-l border-slate-800 px-1.5 py-2 text-center font-medium leading-tight text-slate-300"
                title={c.label}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cluster_id} className="border-t border-slate-800">
              <td className="sticky left-0 z-10 bg-slate-900/95 px-2 py-1.5 font-medium text-slate-200">
                {r.cluster_id}
              </td>
              <td className="bg-slate-900/95 px-2 py-1.5 text-right tabular-nums text-slate-400">
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
                  <td key={c.id} className="border-l border-slate-800 px-0.5 py-0.5 text-center">
                    <div
                      className="rounded px-1 py-1.5 font-medium tabular-nums"
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
