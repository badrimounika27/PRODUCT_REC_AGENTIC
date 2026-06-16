import { Users } from "lucide-react";
import type { InsightPayload } from "../api";

type ProfileMetric = { label: string; value: string };

type Props = {
  clusterLabel: string;
  meta?: { store_count?: number; top_category?: string } | null;
  /** Avg monthly spend, invoice size, invoices/month, days between purchases — from cluster profile row */
  profileMetrics?: ProfileMetric[] | null;
  insight: InsightPayload | null;
  engagementIdeas?: string[];
  loading?: boolean;
  error?: string | null;
};

export function ClusterExplanationCard({
  clusterLabel,
  meta,
  profileMetrics,
  insight,
  engagementIdeas,
  loading,
  error,
}: Props) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h3 className="font-display text-lg font-semibold">{clusterLabel}</h3>
          </div>
          {meta ? (
            <p className="mt-1 text-sm text-slate-500">
              {meta.store_count != null ? `${meta.store_count} stores` : ""}
              {meta.top_category ? ` · top category: ${meta.top_category}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {profileMetrics?.length ? (
        <div className="mt-4 rounded-xl border border-surface-border/80 bg-surface-raised/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cluster feature snapshot</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {profileMetrics.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-slate-500">{m.label}</dt>
                <dd className="font-mono tabular-nums text-slate-200">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-surface-raised" />
      ) : error ? (
        <p className="mt-4 text-sm text-red-300">{error}</p>
      ) : insight ? (
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <p className="leading-relaxed text-slate-200">{insight.insight}</p>
          {engagementIdeas?.length ? (
            <div className="rounded-xl bg-surface-raised p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Engagement ideas</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {engagementIdeas.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Select a cluster to generate an explanation.</p>
      )}
    </div>
  );
}
