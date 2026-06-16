import { ArrowDown, ArrowUp, Zap } from "lucide-react";
import type { PriorityAction } from "../lib/decisionIntel";

type Props = {
  actions: PriorityAction[];
  title?: string;
};

const badge: Record<string, string> = {
  High: "bg-red-500/20 text-red-300 border-red-500/30",
  Medium: "bg-amber-500/15 text-amber-200 border-amber-500/25",
  Low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

export function PriorityActionsPanel({ actions, title = "Priority actions" }: Props) {
  if (!actions.length) {
    return (
      <div className="rounded-2xl border border-dashed border-surface-border bg-surface-card/50 p-6 text-sm text-slate-500">
        Run AI insight or load pipeline data to populate prioritized actions.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-accent/20 bg-gradient-to-br from-surface-card to-surface-raised/80 p-6 shadow-lg shadow-black/20 transition duration-300">
      <div className="flex items-center gap-2">
        <Zap className="h-6 w-6 text-amber-400" />
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Sorted by expected impact · High-impact rows highlighted
      </p>
      <ul className="mt-4 space-y-3">
        {actions.map((a) => {
          const high = a.priority === "High";
          return (
            <li
              key={a.id}
              className={`rounded-xl border px-4 py-3 transition hover:border-accent/40 ${
                high
                  ? "border-emerald-500/35 bg-emerald-950/15 ring-1 ring-emerald-500/20"
                  : "border-surface-border bg-surface/80"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium text-slate-100">{a.title}</p>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${badge[a.priority]}`}
                >
                  {a.priority}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1 text-mint">
                  <ArrowUp className="h-3.5 w-3.5" />
                  Impact: <strong className="text-slate-200">{a.expectedImpact}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <ArrowDown className="h-3.5 w-3.5 opacity-60" />
                  Effort: <strong className="text-slate-300">{a.effort}</strong>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
