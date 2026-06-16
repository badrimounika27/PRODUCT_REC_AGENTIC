import { AlertTriangle, Lightbulb, TrendingUp } from "lucide-react";
import type { InsightPayload } from "../api";

type Props = {
  insight: InsightPayload | null;
  loading?: boolean;
  error?: string | null;
};

export function ForecastInsights({ insight, loading, error }: Props) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-surface-border bg-surface-card"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
        {error}
      </div>
    );
  }

  if (!insight) return null;

  return (
    <div className="space-y-4">
      {insight.forecast_note ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <div className="flex items-center gap-2 text-slate-300">
            <TrendingUp className="h-5 w-5 text-mint" />
            <span className="font-display font-semibold">What may happen next</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{insight.forecast_note}</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-4">
          <div className="flex items-center gap-2 text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Risk warnings</span>
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
            {(insight.risks ?? []).map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-400">⚠</span>
                {r}
              </li>
            ))}
            {!insight.risks?.length ? (
              <li className="text-slate-500">No major risks flagged.</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <Lightbulb className="h-5 w-5 shrink-0" />
            <span className="font-semibold">Opportunities</span>
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
            {(insight.opportunities ?? []).map((o, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-400">💡</span>
                {o}
              </li>
            ))}
            {!insight.opportunities?.length ? (
              <li className="text-slate-500">No opportunities listed.</li>
            ) : null}
          </ul>
        </div>
      </div>

      {(insight.next_actions ?? []).length ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Suggested actions
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">
            {insight.next_actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
