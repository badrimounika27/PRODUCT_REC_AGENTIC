import { FlaskConical } from "lucide-react";
import { useMemo, useState } from "react";
import { runSimulation, type SimulationResult } from "../lib/decisionIntel";

type Props = {
  summary: Record<string, unknown> | null;
  forecast: Record<string, unknown> | null;
  clusterOptions: { id: string; label: string }[];
  categoryOptions: string[];
};

export function SimulationPanel({
  summary,
  forecast,
  clusterOptions,
  categoryOptions,
}: Props) {
  const [upsell, setUpsell] = useState(8);
  const [clusterId, setClusterId] = useState("all");
  const [category, setCategory] = useState("all");

  const result: SimulationResult = useMemo(
    () =>
      runSimulation({
        upsellPct: upsell,
        clusterId,
        category,
        summary,
        forecast,
      }),
    [upsell, clusterId, category, summary, forecast],
  );

  return (
    <section className="rounded-2xl border border-indigo-500/25 bg-indigo-950/10 p-6">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-indigo-400" />
        <h2 className="font-display text-lg font-semibold">What-if simulation</h2>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Adjust upsell intensity and scope — outputs are indicative models on top of pipeline totals.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase text-slate-500">
            Increase upsell %
          </label>
          <input
            type="range"
            min={0}
            max={30}
            value={upsell}
            onChange={(e) => setUpsell(Number(e.target.value))}
            className="mt-2 w-full accent-indigo-500"
          />
          <p className="mt-1 text-center font-mono text-sm text-indigo-200">{upsell}%</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Cluster</label>
            <select
              value={clusterId}
              onChange={(e) => setClusterId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm"
            >
              <option value="all">All clusters</option>
              {clusterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-slate-500">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm"
            >
              <option value="all">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c.length > 28 ? c.slice(0, 27) + "…" : c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-surface-border bg-surface-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-[10px] uppercase text-slate-500">Predicted monthly revenue</p>
            <p className="font-display text-xl font-bold text-white">
              {fmtMoney(result.predictedRevenue)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-slate-500">Growth vs baseline</p>
            <p className="font-display text-xl font-bold text-mint">
              +{result.growthPct.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-slate-500">Risk reduction (modeled)</p>
            <p className="font-display text-xl font-bold text-amber-200">
              {result.riskReductionPct.toFixed(1)}%
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">{result.narrative}</p>
        <p className="mt-2 text-[11px] text-slate-600">
          If applied, revenue increases by ~{fmtMoney(result.predictedRevenue - result.baseMonthlyRevenue)} vs
          baseline; risk score improves by ~{result.riskReductionPct.toFixed(0)}% in this scenario.
        </p>
      </div>
    </section>
  );
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
