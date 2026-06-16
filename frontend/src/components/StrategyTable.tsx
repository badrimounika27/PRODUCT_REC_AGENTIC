import { TableProperties } from "lucide-react";

export type StrategyRow = {
  clusterName: string;
  strategy: string;
  outcome: string;
  topProducts?: string[];
};

type Props = {
  rows: StrategyRow[];
  onApply?: (row: StrategyRow) => void;
  applyLabel?: string;
};

export function StrategyTable({ rows, onApply, applyLabel = "Apply strategy" }: Props) {
  if (!rows.length) {
    return (
      <p className="text-sm text-slate-500">No cluster rows — run pipeline with clustering.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-surface-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-surface-border bg-surface-raised/80">
            <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
              Cluster
            </th>
            <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
              Suggested strategy
            </th>
            <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
              Expected outcome
            </th>
            <th className="px-4 py-3 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
              Top 3 products to push
            </th>
            {onApply ? (
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">
                Action
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-b border-surface-border/80 transition hover:bg-surface-raised/40"
            >
              <td className="px-4 py-3 font-medium text-slate-200">{r.clusterName}</td>
              <td className="max-w-md px-4 py-3 text-slate-400">{r.strategy}</td>
              <td className="whitespace-nowrap px-4 py-3 text-mint">{r.outcome}</td>
              <td className="max-w-sm px-4 py-3 text-slate-300">
                {r.topProducts?.length ? (
                  <ul className="space-y-1">
                    {r.topProducts.slice(0, 3).map((p) => (
                      <li key={p} className="truncate">
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500">Load cluster details</span>
                )}
              </td>
              {onApply ? (
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onApply(r)}
                    className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30"
                  >
                    {applyLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 border-t border-surface-border bg-surface/50 px-4 py-2 text-xs text-slate-600">
        <TableProperties className="h-4 w-4" />
        Cluster strategy playbook — aligned to AI cluster personas where available.
      </div>
    </div>
  );
}
