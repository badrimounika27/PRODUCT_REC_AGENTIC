import { ShoppingBag, Users } from "lucide-react";
import { motion } from "framer-motion";
import type { InsightPayload } from "../api";

type ProfileMetric = { label: string; value: string };

type MixItem = { label: string; value: string };

type Props = {
  clusterLabel: string;
  meta?: { store_count?: number; top_category?: string } | null;
  /** Avg monthly spend, invoice size, invoices/month, days between purchases — from cluster profile row */
  profileMetrics?: ProfileMetric[] | null;
  categoryMix?: MixItem[] | null;
  priceTier?: MixItem[] | null;
  insight: InsightPayload | null;
  engagementIdeas?: string[];
  loading?: boolean;
  error?: string | null;
};

export function ClusterExplanationCard({
  clusterLabel,
  meta,
  profileMetrics,
  categoryMix,
  priceTier,
  insight,
  engagementIdeas,
  loading,
  error,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-surface-border/80 bg-surface-card/70 p-6 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-display text-lg font-semibold text-slate-100">{clusterLabel}</h3>
              {meta ? (
                <p className="mt-0.5 text-sm text-slate-500">
                  {meta.store_count != null ? `${meta.store_count.toLocaleString()} stores` : ""}
                  {meta.top_category ? (
                    <>
                      {" · "}
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <ShoppingBag className="inline h-3 w-3 text-accent" />
                        Top category:{" "}
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                          {meta.top_category}
                        </span>
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {profileMetrics?.length ? (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feature snapshot</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {profileMetrics.map((m, i) => (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, duration: 0.3 }}
                className="rounded-2xl border border-surface-border/70 bg-surface-raised/40 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:bg-surface-raised/60"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{m.label}</p>
                <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-100">{m.value}</p>
              </motion.div>
            ))}
          </div>
        </div>
      ) : null}

      {(categoryMix?.length || priceTier?.length) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {categoryMix?.length ? (
            <div className="rounded-2xl border border-surface-border/70 bg-surface-raised/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category mix</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {categoryMix.map((m) => (
                  <span
                    key={m.label}
                    className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-card/80 px-3 py-1.5 text-xs text-slate-300"
                  >
                    <span className="text-slate-500">{m.label}</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-100">{m.value}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {priceTier?.length ? (
            <div className="rounded-2xl border border-surface-border/70 bg-surface-raised/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price tier mix</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {priceTier.map((m) => (
                  <span
                    key={m.label}
                    className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-card/80 px-3 py-1.5 text-xs text-slate-300"
                  >
                    <span className="text-slate-500">{m.label}</span>
                    <span className="font-mono font-semibold tabular-nums text-slate-100">{m.value}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {loading ? (
        <div className="mt-6 h-24 animate-pulse rounded-2xl bg-surface-raised/60" />
      ) : error ? (
        <p className="mt-6 text-sm text-red-300">{error}</p>
      ) : insight ? (
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <p className="leading-relaxed text-slate-200">{insight.insight}</p>
          {engagementIdeas?.length ? (
            <div className="rounded-2xl border border-surface-border/60 bg-surface-raised/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Engagement ideas</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-slate-300">
                {engagementIdeas.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Select a cluster to generate an explanation.</p>
      )}
    </motion.div>
  );
}
