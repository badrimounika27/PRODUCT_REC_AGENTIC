import { Calendar } from "lucide-react";
import { monthlyPlannerOutput } from "../lib/decisionIntel";

type Props = {
  monthIndex: number;
  onMonthChange: (n: number) => void;
  categories: { name: string; value: number }[];
  seasonalitySignals?: {
    promote: string[];
    avoid: string[];
  };
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function MonthlyPlanner({ monthIndex, onMonthChange, categories, seasonalitySignals }: Props) {
  const plan = monthlyPlannerOutput({ monthIndex, categories });
  const promoteLines = seasonalitySignals?.promote?.length ? seasonalitySignals.promote : plan.promote;
  const avoidLines = seasonalitySignals?.avoid?.length ? seasonalitySignals.avoid : plan.avoid;

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-violet-950/10 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-6 w-6 text-violet-400" />
          <h2 className="font-display text-lg font-semibold">Monthly recommendation planner</h2>
        </div>
        <select
          value={monthIndex}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-400/90">Top categories to recommend</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {promoteLines.map((c) => (
              <li key={c}>📦 {c}</li>
            ))}
            {!promoteLines.length ? <li className="text-slate-600">—</li> : null}
          </ul>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-950/10 p-4">
          <p className="text-xs font-semibold uppercase text-red-300/90">Categories to watch / avoid</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {avoidLines.map((c) => (
              <li key={c}>⚠ {c}</li>
            ))}
            {!avoidLines.length ? <li className="text-slate-600">—</li> : null}
          </ul>
        </div>
        <div className="rounded-xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Strategy suggestions</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-400">
            {plan.strategy.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
