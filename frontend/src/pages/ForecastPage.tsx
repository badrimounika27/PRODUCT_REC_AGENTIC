import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchDashboardAnalytics,
  fetchForecastContext,
  fetchSummary,
  postInsightForecast,
  type InsightPayload,
} from "../api";
import { AIInsightCard } from "../components/AIInsightCard";
import { ConfidenceGauge } from "../components/ConfidenceGauge";
import { ForecastInsights } from "../components/ForecastInsights";
import { ForecastSimulator } from "../components/ForecastSimulator";
import { FutureDecisionPanel } from "../components/FutureDecisionPanel";
import { MonthlyPlanner } from "../components/MonthlyPlanner";
import { ResizableChartCard } from "../components/analytics/ResizableChartCard";
import { SplitPane } from "../components/analytics/SplitPane";
import { futureDecisionBullets } from "../lib/decisionIntel";

export function ForecastPage() {
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<Record<string, unknown> | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth());
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const loadContext = useCallback(async () => {
    try {
      const r = await fetchForecastContext();
      setCtx(r);
      setCtxErr(null);
    } catch (e) {
      setCtxErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      const r = await fetchDashboardAnalytics();
      setAnalytics(r);
    } catch {
      setAnalytics(null);
    }
  }, []);

  const refreshForecastCharts = useCallback(async () => {
    await Promise.all([loadContext(), loadAnalytics()]);
  }, [loadContext, loadAnalytics]);

  useEffect(() => {
    loadContext();
    fetchSummary().then(setSummary).catch(() => setSummary(null));
    loadAnalytics();
  }, [loadContext, loadAnalytics]);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    postInsightForecast()
      .then((r) => setInsight(r.insight))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const share = ctx?.source_value_share as Record<string, number> | undefined;
  const barData = share
    ? Object.entries(share).map(([name, value]) => ({ name, value: Number(value) }))
    : [];
  const cats = ctx?.top_categories_by_amount as Record<string, number> | undefined;
  const catData = cats
    ? Object.entries(cats)
        .map(([name, value]) => ({ name: name.slice(0, 20), value: Number(value) }))
        .slice(0, 10)
    : [];

  const meanConf = ctx?.mean_confidence != null ? Number(ctx.mean_confidence) : null;
  const lowRows = ctx?.low_confidence_rows != null ? Number(ctx.low_confidence_rows) : null;
  const benchmarkConf = 0.65;
  const sourceShare = (ctx?.source_value_share as Record<string, number> | undefined) ?? {};
  const sourceTotal = Object.values(sourceShare).reduce((a, v) => a + Number(v || 0), 0);
  const alsSharePct = sourceTotal > 0 ? (Number(sourceShare.ALS ?? 0) / sourceTotal) * 100 : null;
  const monthlyUplift = summary?.estimated_monthly_revenue_uplift != null
    ? Number(summary.estimated_monthly_revenue_uplift)
    : null;
  const upsellPct = summary?.pct_stores_with_upsell_opportunity != null
    ? Number(summary.pct_stores_with_upsell_opportunity)
    : null;
  const forecastAccuracy = (ctx?.forecast_accuracy as Record<string, unknown> | undefined) ?? undefined;

  const plannerCats = useMemo(() => {
    if (cats) {
      return Object.entries(cats)
        .map(([name, value]) => ({ name, value: Number(value) }))
        .sort((a, b) => b.value - a.value);
    }
    const top = (summary?.top_10_products_overall as Array<{ count: number }>) ?? [];
    return top.map((t, i) => ({ name: `Category ${i + 1}`, value: t.count }));
  }, [cats, summary]);

  const seasonalitySignals = useMemo(() => {
    const heat = (analytics?.seasonality_heatmap as
      | { categories?: string[]; months?: string[]; matrix?: number[][] }
      | undefined) ?? { categories: [], months: [], matrix: [] };
    const categories = heat.categories ?? [];
    const months = heat.months ?? [];
    const matrix = heat.matrix ?? [];
    if (!categories.length || !months.length || !matrix.length) return { promote: [], avoid: [] };

    const monthName = new Date(2000, monthIdx, 1).toLocaleString(undefined, { month: "long" });
    const rows: Array<{ category: string; index: number }> = [];
    categories.forEach((category, i) => {
      const row = matrix[i] ?? [];
      if (!row.length) return;
      const monthVals = row
        .map((v, j) => ({ month: Number(String(months[j]).slice(5, 7)) - 1, value: Number(v ?? 0) }))
        .filter((x) => Number.isFinite(x.month) && Number.isFinite(x.value) && x.month >= 0);
      if (!monthVals.length) return;
      const selected = monthVals.filter((x) => x.month === monthIdx).map((x) => x.value);
      if (!selected.length) return;
      const avg = monthVals.reduce((a, b) => a + b.value, 0) / monthVals.length;
      if (!Number.isFinite(avg) || avg <= 0) return;
      const selAvg = selected.reduce((a, b) => a + b, 0) / selected.length;
      rows.push({ category, index: selAvg / avg });
    });

    const promote = rows
      .filter((r) => r.index >= 1.05)
      .sort((a, b) => b.index - a.index)
      .slice(0, 4)
      .map((r) => `${r.category} -> push in ${monthName} (seasonality ${r.index.toFixed(2)})`);
    const avoid = rows
      .filter((r) => r.index <= 0.95)
      .sort((a, b) => a.index - b.index)
      .slice(0, 4)
      .map((r) => `${r.category} -> avoid pushing in ${monthName} (seasonality ${r.index.toFixed(2)})`);

    return { promote, avoid };
  }, [analytics, monthIdx]);

  const futureBullets = useMemo(() => futureDecisionBullets(insight), [insight]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Analysis</h1>
        <p className="mt-1 max-w-3xl text-slate-400">
          Product-first scenarios, network outlook, and monthly planning — use the sections below for follow-ups.
        </p>
      </div>

      <ForecastSimulator />

      {ctxErr ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
          Context: {ctxErr}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs uppercase text-slate-500">Mean confidence</p>
          <p className="mt-1 font-display text-2xl font-bold text-white">
            {meanConf != null ? meanConf.toFixed(3) : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Industry benchmark: {benchmarkConf.toFixed(2)}{" "}
            {meanConf != null ? (
              <span className={meanConf >= benchmarkConf ? "text-emerald-300" : "text-amber-300"}>
                ({meanConf >= benchmarkConf ? "above benchmark" : "below benchmark"})
              </span>
            ) : null}
          </p>
          {meanConf != null ? (
            <div className="mt-3">
              <ConfidenceGauge value={meanConf} label="Network confidence" />
            </div>
          ) : null}
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs uppercase text-slate-500">Recommendations needing review (&lt; 0.5 confidence)</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-200">
            {lowRows != null ? lowRows.toLocaleString() : "—"}
          </p>
          <button
            type="button"
            onClick={() => navigate("/recommendations?focus=low-confidence")}
            className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
          >
            Review low-confidence recos
          </button>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs uppercase text-slate-500">Total estimated amount</p>
          <p className="mt-1 font-display text-2xl font-bold text-mint">
            {ctx?.total_estimated_amount != null
              ? fmtMoney(Number(ctx.total_estimated_amount))
              : "—"}
          </p>
        </div>
      </div>

      <FutureDecisionPanel bullets={futureBullets} loading={loading} />

      <MonthlyPlanner
        monthIndex={monthIdx}
        onMonthChange={setMonthIdx}
        categories={plannerCats}
        seasonalitySignals={seasonalitySignals}
      />

      <SplitPane id="forecast-bars-pair">
        <ResizableChartCard
          id="forecast-value-by-source"
          title="Value by source"
          bodyClassName="h-64"
          onRefresh={refreshForecastCharts}
        >
          {barData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" />
                <XAxis dataKey="name" stroke="#64748b" />
                <YAxis stroke="#64748b" tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip
                  contentStyle={{
                    background: "#12171f",
                    border: "1px solid #2a3344",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">No data</p>
          )}
        </ResizableChartCard>

        <ResizableChartCard
          id="forecast-top-categories"
          title="Top categories by amount"
          bodyClassName="h-64"
          onRefresh={refreshForecastCharts}
        >
          {catData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catData} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" />
                <XAxis type="number" stroke="#64748b" tickFormatter={(v) => fmtCompact(v)} />
                <YAxis dataKey="name" type="category" width={100} stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#12171f",
                    border: "1px solid #2a3344",
                    borderRadius: "8px",
                  }}
                />
                <Bar dataKey="value" fill="#34d399" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">No data</p>
          )}
        </ResizableChartCard>
      </SplitPane>

      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatChip
            label="Modeled uplift"
            value={monthlyUplift != null ? fmtInrCompact(monthlyUplift) : "—"}
          />
          <StatChip
            label="ALS drives"
            value={alsSharePct != null ? `${alsSharePct.toFixed(0)}%` : "—"}
          />
          <StatChip
            label="Upsell opportunity"
            value={upsellPct != null ? `${upsellPct.toFixed(2)}%` : "—"}
          />
        </div>
        <AIInsightCard
          title="Forecast agent — narrative"
          insight={insight}
          loading={loading}
          error={err}
        />
      </section>

      <section className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-slate-200">Forecast accuracy (last month)</h2>
        {forecastAccuracy?.available === true ? (
          <div className="mt-3 space-y-2 text-sm text-slate-300">
            <p>
              Forecasted {fmtInrCompact(Number(forecastAccuracy.forecast_amount ?? 0))} vs actual{" "}
              {fmtInrCompact(Number(forecastAccuracy.actual_amount ?? 0))} in{" "}
              {String(forecastAccuracy.month_label ?? "last month")}.
            </p>
            <p>
              Accuracy{" "}
              <span className="font-semibold text-emerald-300">
                {Number(forecastAccuracy.accuracy_pct ?? 0).toFixed(1)}%
              </span>
            </p>
            <p className="text-xs text-slate-500">
              Based on transaction actuals and monthlyized forecast amount from current recommendation outputs.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Historical forecast-versus-actual window is not available in current data.
          </p>
        )}
      </section>

      <ForecastInsights insight={insight} loading={loading} error={err} />
    </div>
  );
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

function fmtInrCompact(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function fmtCompact(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
