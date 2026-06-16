import { Sparkles } from "lucide-react";
import type { InsightPayload } from "../api";

type Props = {
  title?: string;
  insight: InsightPayload | null;
  loading?: boolean;
  error?: string | null;
};

export function AIInsightCard({ title = "AI insight", insight, loading, error }: Props) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-surface-border bg-surface-card p-6 shadow-lg shadow-black/20">
        <div className="flex items-center gap-2 text-slate-400">
          <Sparkles className="h-5 w-5 animate-pulse text-accent" />
          <span className="text-sm font-medium">Generating insight…</span>
        </div>
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-raised" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-6">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  if (!insight) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-gradient-to-br from-surface-card to-surface-raised p-6 shadow-xl shadow-black/30">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-accent" />
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-200">{insight.insight}</p>
      {insight.next_actions?.length ? (
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/5 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Action steps</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-200">
            {insight.next_actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {insight.key_points?.length ? (
        <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
          {insight.key_points.map((k, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{k}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {insight.trends?.length ? (
        <div className="mt-4 rounded-xl border border-surface-border bg-surface/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Why (trends)
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {insight.trends.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
