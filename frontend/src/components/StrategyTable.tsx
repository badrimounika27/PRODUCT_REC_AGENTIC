import { TableProperties } from "lucide-react";
import { motion } from "framer-motion";

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
  selectedClusterId?: number | null;
};

function clusterIdFromName(name: string): number | null {
  const m = name.match(/Cluster\s+(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function StrategyTable({
  rows,
  onApply,
  applyLabel = "Apply strategy",
  selectedClusterId = null,
}: Props) {
  if (!rows.length) {
    return <p className="text-sm text-slate-500">No cluster rows — run pipeline with clustering.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-border/80 bg-surface-card/60 shadow-lg shadow-black/20 backdrop-blur-sm">
      <div className="border-b border-surface-border/80 px-5 py-4 sm:px-6">
        <h2 className="font-display text-lg font-semibold text-slate-100">Strategy playbook</h2>
        <p className="mt-1 text-sm text-slate-500">Suggested plays, outcomes, and products to push per cluster.</p>
      </div>

      {/* Desktop header */}
      <div className="hidden grid-cols-[minmax(140px,1.1fr)_minmax(180px,1.6fr)_minmax(160px,1.2fr)_minmax(180px,1.4fr)] gap-4 border-b border-surface-border/60 px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:grid xl:grid-cols-[1.1fr_1.6fr_1.2fr_1.4fr_auto] xl:px-6">
        <span>Cluster</span>
        <span>Suggested strategy</span>
        <span>Expected outcome</span>
        <span>Top products to push</span>
        {onApply ? <span className="text-right">Action</span> : null}
      </div>

      <div className="divide-y divide-surface-border/50">
        {rows.map((r, i) => {
          const cid = clusterIdFromName(r.clusterName);
          const isSelected = selectedClusterId != null && cid === selectedClusterId;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.35 }}
              className={`grid gap-4 px-5 py-4 transition-colors duration-200 lg:grid-cols-[minmax(140px,1.1fr)_minmax(180px,1.6fr)_minmax(160px,1.2fr)_minmax(180px,1.4fr)] xl:grid-cols-[1.1fr_1.6fr_1.2fr_1.4fr_auto] xl:px-6 ${
                isSelected
                  ? "bg-accent/10 ring-1 ring-inset ring-accent/30"
                  : "hover:bg-surface-raised/40"
              } ${onApply ? "" : ""}`}
            >
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:hidden">
                  Cluster
                </p>
                <p className="font-medium text-slate-100">{r.clusterName}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:hidden">
                  Suggested strategy
                </p>
                <p className="text-sm leading-relaxed text-slate-400">{r.strategy}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:hidden">
                  Expected outcome
                </p>
                <span className="inline-flex max-w-full items-center rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-xs font-medium text-mint">
                  {r.outcome}
                </span>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:hidden">
                  Top products to push
                </p>
                {r.topProducts?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.topProducts.slice(0, 3).map((p) => (
                      <span
                        key={p}
                        className="inline-flex max-w-full truncate rounded-full border border-surface-border bg-surface-raised/60 px-2.5 py-1 text-[11px] text-slate-300"
                        title={p}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-slate-500">Load cluster details</span>
                )}
              </div>
              {onApply ? (
                <div className="flex items-start justify-end">
                  <button
                    type="button"
                    onClick={() => onApply(r)}
                    className="rounded-xl bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/30"
                  >
                    {applyLabel}
                  </button>
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-surface-border/80 bg-surface/40 px-5 py-3 text-xs text-slate-600 xl:px-6">
        <TableProperties className="h-4 w-4" />
        Cluster strategy playbook — aligned to AI cluster personas where available.
      </div>
    </div>
  );
}
