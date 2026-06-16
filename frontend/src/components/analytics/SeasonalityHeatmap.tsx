import { heatmapCellTextColor, heatmapIntensityColor } from "./chartTheme";

type Props = {
  categories: string[];
  months: string[];
  matrix: number[][];
};

function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})/);
  if (!m) return ym;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

export function SeasonalityHeatmap({ categories, months, matrix }: Props) {
  if (!categories.length || !months.length || !matrix.length) {
    return <p className="text-sm text-slate-500">Not enough category and month data to show this view.</p>;
  }

  let max = 0;
  for (const row of matrix) {
    for (const v of row) max = Math.max(max, v);
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-medium text-slate-400">Intensity:</span>
        <span className="inline-flex items-center gap-1.5 rounded border border-slate-700/80 bg-slate-900/50 px-2 py-1">
          <span className="h-3 w-8 rounded-sm bg-red-700" />
          <span>Lower</span>
          <span className="text-slate-600">→</span>
          <span className="h-3 w-8 rounded-sm bg-amber-600" />
          <span className="h-3 w-8 rounded-sm bg-orange-600" />
          <span className="h-3 w-8 rounded-sm bg-emerald-700" />
          <span>Higher</span>
        </span>
      </div>
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-slate-900/95 px-2 py-2 text-left font-medium text-slate-400">
              Category
            </th>
            {months.map((m) => (
              <th key={m} className="px-1 py-2 text-center font-medium text-slate-500">
                {monthLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, i) => (
            <tr key={cat} className="border-t border-slate-800">
              <td className="sticky left-0 z-10 max-w-[140px] truncate bg-slate-900/95 px-2 py-1.5 text-slate-300">
                {cat}
              </td>
              {(matrix[i] ?? []).map((v, j) => {
                const raw = max > 0 ? Math.min(1, v / max) : 0;
                const a = 1 - raw;
                const bg = heatmapIntensityColor(a);
                const fg = heatmapCellTextColor(a);
                return (
                  <td key={j} className="px-0.5 py-0.5 text-center">
                    <div
                      className="rounded px-1 py-2 text-[10px] font-medium tabular-nums"
                      style={{
                        backgroundColor: bg,
                        color: fg,
                        textShadow:
                          a > 0.35 && a < 0.78
                            ? "0 1px 2px rgba(255,255,255,0.4)"
                            : "0 1px 2px rgba(0,0,0,0.35)",
                      }}
                      title={`${monthLabel(months[j] ?? "")}: ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    >
                      {v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-600">
        Higher relative revenue is greener; lower is redder (within this category × month grid).
      </p>
    </div>
  );
}
