import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchDashboardAnalytics, fetchSeasonalityByCategory, fetchSeasonalityL2Categories } from "../api";
import { FeatureInsightsBoxPlot } from "../components/analytics/FeatureInsightsBoxPlot";
import { ResizableChartCard } from "../components/analytics/ResizableChartCard";
import { SplitPane } from "../components/analytics/SplitPane";
import {
  BAR_FILL_SPECTRUM,
  PIE_COLORS,
  SERIES_LINE_COLORS,
  TIME_SERIES,
  TREND,
  chartTooltipProps,
} from "../components/analytics/chartTheme";
import { SeasonalityHeatmap } from "../components/analytics/SeasonalityHeatmap";
import { scalePercentLikeValue } from "../lib/percentDisplay";

/** Calendar period labels (e.g. 2024-03 → Mar 2024) for chart axes */
function formatPeriodLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})/);
  if (!m) return ym;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

const L2_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Dashboard() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [l2Options, setL2Options] = useState<string[]>([]);
  const [l2Selected, setL2Selected] = useState("");
  const [l2Season, setL2Season] = useState<Awaited<ReturnType<typeof fetchSeasonalityByCategory>> | null>(null);

  const loadAnalytics = useCallback(async () => {
    try {
      const result = await fetchDashboardAnalytics();
      setData(result);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadL2Options = useCallback(async () => {
    try {
      const r = await fetchSeasonalityL2Categories();
      setL2Options(r.categories ?? []);
    } catch {
      setL2Options([]);
    }
  }, []);

  const loadL2Season = useCallback(async (cat: string) => {
    if (!cat) {
      setL2Season(null);
      return;
    }
    try {
      const s = await fetchSeasonalityByCategory(cat);
      setL2Season(s);
    } catch {
      setL2Season(null);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    loadL2Options();
  }, [loadL2Options]);

  useEffect(() => {
    if (!l2Selected) {
      setL2Season(null);
      return;
    }
    let cancelled = false;
    fetchSeasonalityByCategory(l2Selected)
      .then((s) => {
        if (!cancelled) setL2Season(s);
      })
      .catch(() => {
        if (!cancelled) setL2Season(null);
      });
    return () => {
      cancelled = true;
    };
  }, [l2Selected]);

  const refreshDemandIndex = useCallback(async () => {
    await Promise.all([loadAnalytics(), loadL2Season(l2Selected)]);
  }, [loadAnalytics, loadL2Season, l2Selected]);

  const meta = data?.meta as Record<string, unknown> | undefined;
  const overview = (data?.overview as Record<string, unknown>) ?? {};
  const monthly = (data?.monthly_trend as Array<Record<string, unknown>>) ?? [];
  const lineHist = (data?.line_amount_histogram as Array<{ bin: string; count: number }>) ?? [];
  const freqHist = (data?.invoice_frequency_histogram as Array<{ bin: string; count: number }>) ?? [];
  const features = (data?.feature_insights as Record<string, Record<string, number>>) ?? {};
  const catIntel = (data?.category_intelligence as Array<Record<string, unknown>>) ?? [];
  const heat = (data?.seasonality_heatmap as { categories: string[]; months: string[]; matrix: number[][] }) ?? {
    categories: [],
    months: [],
    matrix: [],
  };

  /** Prefer API list from seasonality_multipliers.csv; if empty, use dashboard heatmap categories so the chart always has a selector. */
  const effectiveL2Options = useMemo(() => {
    if (l2Options.length) return l2Options;
    return (heat.categories ?? []).filter((c) => String(c).trim().length > 0);
  }, [l2Options, heat.categories]);

  useEffect(() => {
    if (!effectiveL2Options.length) {
      setL2Selected("");
      return;
    }
    setL2Selected((prev) => (prev && effectiveL2Options.includes(prev) ? prev : effectiveL2Options[0]));
  }, [effectiveL2Options]);
  const pie = (data?.category_contribution as Array<{ name: string; value: number }>) ?? [];
  const kpiTrends = (data?.kpi_trends as Record<string, number | null>) ?? {};
  const timePeriodLabel = String(meta?.time_period_label ?? "");

  const monthlyRevenueMean = useMemo(() => {
    if (!monthly.length) return 0;
    const s = monthly.reduce((acc, r) => acc + Number(r.revenue ?? 0), 0);
    return s / monthly.length;
  }, [monthly]);

  const monthlyOrdersMean = useMemo(() => {
    if (!monthly.length) return 0;
    const s = monthly.reduce((acc, r) => acc + Number(r.orders ?? 0), 0);
    return s / monthly.length;
  }, [monthly]);

  const l2SeasonalLineData = useMemo(() => {
    if (!l2Season?.multipliers) return [];
    return L2_MONTH_SHORT.map((name, i) => ({
      month: name,
      mult: Number(l2Season.multipliers[String(i + 1)] ?? 1),
    }));
  }, [l2Season]);

  /** Always 12 months: real multipliers or flat 1.0 so the bar chart is never empty. */
  const l2ChartRows = useMemo(() => {
    if (l2SeasonalLineData.length) return l2SeasonalLineData;
    return L2_MONTH_SHORT.map((month) => ({ month, mult: 1 }));
  }, [l2SeasonalLineData]);

  const l2ChartIsBaseline = l2SeasonalLineData.length === 0;

  /** Higher multiplier → green; lower → red (within the visible year range). */
  const l2BarFillColors = useMemo(() => {
    if (!l2ChartRows.length) return [];
    const vals = l2ChartRows.map((r) => r.mult);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    return l2ChartRows.map((r) => {
      if (!(maxV > minV)) return "hsl(142, 55%, 40%)";
      const t = Math.max(0, Math.min(1, (r.mult - minV) / (maxV - minV)));
      const h = Math.round(t * 120);
      return `hsl(${h}, 58%, 42%)`;
    });
  }, [l2ChartRows]);

  const bestMonthsToPush = useMemo(() => {
    if (!heat.categories.length || !heat.months.length || !heat.matrix.length) return [];
    return heat.categories.map((cat, i) => {
      const row = heat.matrix[i] ?? [];
      if (!row.length) return { category: cat, bestMonth: "—", bestValue: 0 };
      let bestIdx = 0;
      let bestValue = Number(row[0] ?? 0);
      for (let j = 1; j < row.length; j++) {
        const v = Number(row[j] ?? 0);
        if (v > bestValue) {
          bestValue = v;
          bestIdx = j;
        }
      }
      return {
        category: cat,
        bestMonth: formatPeriodLabel(String(heat.months[bestIdx] ?? "—")),
        bestValue,
      };
    });
  }, [heat]);

  const categoryLineData = useMemo(() => {
    if (!heat.months.length || !heat.categories.length) return [];
    return heat.months.map((m, j) => {
      const row: Record<string, string | number> = { month: formatPeriodLabel(m) };
      heat.categories.slice(0, 5).forEach((c, i) => {
        row[c] = heat.matrix[i]?.[j] ?? 0;
      });
      return row;
    });
  }, [heat]);

  const available = meta?.transactions_available === true;
  const loading = !data && !err;

  if (err) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-6 text-sm text-slate-300">
        {err}
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-12">
      <header className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Analytics</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
          Sales performance, buying patterns, and category trends — a single place to review the numbers behind your
          business.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading analytics…</p>
        ) : null}
        {!loading && !available ? (
          <p className="mt-3 text-sm text-slate-400">
            Sales transaction data is not available yet. Ask your administrator to load the dataset so these views can
            populate.
          </p>
        ) : null}
        {!loading && overview.locations_note ? (
          <p className="mt-2 text-xs text-slate-600">{String(overview.locations_note)}</p>
        ) : null}
      </header>

      {loading ? (
        <div className="animate-pulse space-y-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-800/90" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-72 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-4 h-4 w-40 rounded bg-slate-800" />
                <div className="h-[calc(100%-2rem)] rounded-lg bg-slate-800/60" />
              </div>
            ))}
          </div>
          <div className="h-48 rounded-xl border border-slate-800 bg-slate-900/40" />
        </div>
      ) : null}

      {!loading ? (
        <>

      {/* 1. KPIs */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">At a glance</h2>
          {timePeriodLabel ? (
            <p className="text-[11px] text-slate-500">Coverage: {timePeriodLabel}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
          <Kpi
            label="Total revenue"
            value={fmtMoney(Number(overview.total_revenue ?? 0))}
            trendPct={kpiTrends.total_revenue}
            trendLabel="vs last month"
          />
          <Kpi
            label="Total transactions"
            value={fmtInt(Number(overview.total_transactions ?? 0))}
            trendPct={kpiTrends.total_transactions}
            trendLabel="vs last month"
          />
          <Kpi
            label="Total stores"
            value={fmtInt(Number(overview.total_stores ?? overview.total_customers ?? 0))}
            sub="Unique store locations"
            trendPct={kpiTrends.total_customers}
            trendLabel="vs last month"
          />
          <Kpi
            label="Total recommendations"
            value={fmtInt(Number(overview.total_recommendations ?? 0))}
            sub="Rows in recommendations output"
          />
          <Kpi
            label="Unique products"
            value={fmtInt(Number(overview.total_unique_products ?? 0))}
            trendPct={kpiTrends.total_unique_products}
            trendLabel="vs last month"
          />
          <Kpi
            label="Est. revenue opportunity"
            value={fmtMoney(Number(overview.estimated_revenue_opportunity ?? 0))}
            sub="Total FINAL_ADJUSTED_AMT across recommendations"
            trendPct={kpiTrends.estimated_revenue_opportunity}
            trendLabel="vs prior run"
          />
          <Kpi
            label="Avg monthly spend"
            value={fmtMoney(Number(overview.average_monthly_spend ?? 0))}
            sub="Typical monthly spend per location (when available)"
            trendPct={kpiTrends.average_monthly_spend}
            trendLabel="vs last month"
          />
          <Kpi
            label="Avg invoice value"
            value={fmtMoney(Number(overview.average_invoice_value ?? 0))}
            trendPct={kpiTrends.average_invoice_value}
            trendLabel="vs last month"
          />
        </div>
      </section>

      {/* L2 seasonal demand index — bar chart; directly under “At a glance”, above “Purchase behavior” */}
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold tracking-tight text-slate-200">Seasonal demand by month (L2 category)</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            Compare expected demand strength across calendar months for the selected L2 category. The index is
            normalized so 1.0 represents typical (average) demand; bars above the reference line suggest stronger
            seasonal pull, and bars below suggest quieter months. Colors run from lower demand (red tones) to higher
            demand (green tones) within the current view.
          </p>
        </div>
        <ResizableChartCard
          id="demand-index"
          title={l2Selected ? `Demand index — ${l2Selected}` : "Demand index (calendar months)"}
          subtitle={
            l2ChartIsBaseline
              ? "Baseline view (1.0) until multiplier data loads — confirm the API can read seasonality outputs, or set RECOMMENDATION_ENGINE_ROOT / SEASONALITY_MULTIPLIERS_CSV if files live outside the default path."
              : "Monthly multipliers from the seasonality model; dashed line = category baseline (1.0)."
          }
          bodyClassName="h-72"
          onRefresh={refreshDemandIndex}
          headerExtra={
            effectiveL2Options.length ? (
              <select
                value={l2Selected}
                onChange={(e) => setL2Selected(e.target.value)}
                aria-label="L2 category"
                className="min-w-[180px] rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500"
              >
                {effectiveL2Options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : null
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={l2ChartRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                stroke="#475569"
                domain={[0, "auto"]}
                tickFormatter={(v) => Number(v).toFixed(2)}
              />
              <Tooltip {...chartTooltipProps} formatter={(v: number) => [Number(v).toFixed(3), "Index"]} />
              <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
              <Bar dataKey="mult" name="Seasonal index" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {l2ChartRows.map((_, i) => (
                  <Cell key={i} fill={l2BarFillColors[i] ?? "#64748b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ResizableChartCard>
      </section>

      {/* 2. Purchase behavior */}
      <section className="space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Purchase behavior</h2>

        <SplitPane id="purchase-behavior-pair">
          <ResizableChartCard
            id="invoice-frequency"
            title="Invoice frequency distribution"
            subtitle="How many invoices locations tend to place in a typical month."
            bodyClassName="h-72"
            onRefresh={loadAnalytics}
          >
            {freqHist.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={freqHist} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {freqHist.map((_, i) => (
                      <Cell key={i} fill={BAR_FILL_SPECTRUM[(i + 4) % BAR_FILL_SPECTRUM.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ResizableChartCard>

          <ResizableChartCard
            id="monthly-purchase-trend"
            title="Monthly purchase trend"
            subtitle="Revenue and number of invoices by month."
            bodyClassName="h-72"
            onRefresh={loadAnalytics}
          >
            {monthly.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis
                    dataKey="YEAR_MONTH"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    stroke="#475569"
                    tickFormatter={(v) => formatPeriodLabel(String(v))}
                  />
                  <YAxis
                    yAxisId="r"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    stroke="#475569"
                    tickFormatter={(v) => fmtCompact(Number(v))}
                  />
                  <YAxis
                    yAxisId="o"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    stroke="#475569"
                  />
                  <Tooltip {...chartTooltipProps} />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
                  <ReferenceLine
                    yAxisId="r"
                    y={monthlyRevenueMean}
                    stroke={TIME_SERIES.revenueRef}
                    strokeDasharray="5 5"
                    strokeOpacity={0.9}
                  />
                  <ReferenceLine
                    yAxisId="o"
                    y={monthlyOrdersMean}
                    stroke={TIME_SERIES.ordersRef}
                    strokeDasharray="5 5"
                    strokeOpacity={0.9}
                  />
                  <Area
                    yAxisId="r"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    fill={TREND.areaFill}
                    stroke={TREND.areaStroke}
                    fillOpacity={0.32}
                  />
                  <Line
                    yAxisId="o"
                    type="monotone"
                    dataKey="orders"
                    name="Invoices"
                    stroke={TREND.lineOrders}
                    dot={false}
                    strokeWidth={2.5}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ResizableChartCard>
        </SplitPane>

        <ResizableChartCard
          id="line-item-distribution"
          title="Line-item amount distribution"
          subtitle="How often purchase lines fall into each amount band."
          bodyClassName="h-72"
          onRefresh={loadAnalytics}
        >
          {lineHist.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineHist} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="bin" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" interval={0} angle={-25} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" />
                <Tooltip {...chartTooltipProps} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {lineHist.map((_, i) => (
                    <Cell key={i} fill={BAR_FILL_SPECTRUM[i % BAR_FILL_SPECTRUM.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ResizableChartCard>
      </section>

      {/* 3. Feature insights */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">Store-level metrics</h2>
        <p className="mb-4 text-sm text-slate-500">
          Summary statistics across locations for key buying patterns — averages, typical values, and spread.
        </p>
        <FeatureInsightsBoxPlot
          features={features as Record<string, { mean: number; median: number; std: number; min: number; max: number }>}
        />
      </section>

      {/* 4. Category intelligence */}
      <section className="space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Category performance</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-700/80">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/80">
                <th className="px-3 py-3 text-left font-medium text-slate-400">Category</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Revenue</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Growth (period)</th>
                <th className="px-3 py-3 text-left font-medium text-slate-400">Peak month</th>
                <th className="px-3 py-3 text-right font-medium text-slate-400">Avg. discount</th>
              </tr>
            </thead>
            <tbody>
              {catIntel.map((row) => {
                const growthDisplay = scalePercentLikeValue(Number(row.growth_pct_first_to_last_month ?? 0));
                const discountDisplay = scalePercentLikeValue(Number(row.avg_discount_pct ?? 0));
                return (
                <tr key={String(row.category)} className="border-b border-slate-800/80">
                  <td className="max-w-[200px] truncate px-3 py-2 text-slate-300">{String(row.category)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{fmtRevenuePlain(Number(row.total_revenue ?? 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {growthDisplay.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{formatPeakMonth(String(row.peak_month ?? "—"))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {discountDisplay.toFixed(2)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Category contribution</h3>
          <ResizableChartCard
            id="category-pie"
            title="Share of revenue (top categories)"
            subtitle="Each slice is a category's share of revenue."
            bodyClassName="h-80"
            onRefresh={loadAnalytics}
          >
            {pie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke="#0f172a"
                    strokeWidth={1}
                    labelLine={{ stroke: "#64748b", strokeWidth: 1 }}
                    label={PieSliceLabel}
                  >
                    {pie.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(value: number, name: string) => [fmtRevenuePlain(Number(value)), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ResizableChartCard>
        </div>

        <ResizableChartCard
          id="monthly-revenue-by-category"
          title="Monthly revenue by category (top five)"
          subtitle="Each line is a product category; values are shown as separate lines for clarity."
          bodyClassName="h-80"
          onRefresh={loadAnalytics}
        >
          {categoryLineData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={categoryLineData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} stroke="#475569" />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" tickFormatter={(v) => fmtCompact(Number(v))} />
                <Tooltip {...chartTooltipProps} />
                <Legend wrapperStyle={{ fontSize: "10px", color: "#94a3b8" }} />
                {heat.categories.slice(0, 5).map((c, i) => (
                  <Line
                    key={c}
                    type="monotone"
                    dataKey={c}
                    stroke={SERIES_LINE_COLORS[i % SERIES_LINE_COLORS.length]}
                    dot={false}
                    strokeWidth={2.5}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ResizableChartCard>

        <ResizableChartCard
          id="seasonality"
          title="Seasonality"
          subtitle="Categories compared month by month, with quick guidance on the best month to push each category."
          bodyClassName=""
          onRefresh={loadAnalytics}
        >
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <SeasonalityHeatmap categories={heat.categories} months={heat.months} matrix={heat.matrix} />
            <div className="overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/40">
              <div className="border-b border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Best month to push
              </div>
              <div className="max-h-[320px] overflow-auto">
                {bestMonthsToPush.length ? (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900/60 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Category</th>
                        <th className="px-3 py-2 text-left font-medium">Best month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bestMonthsToPush.map((r) => (
                        <tr key={r.category} className="border-t border-slate-800/80">
                          <td className="px-3 py-2 text-slate-300">{r.category}</td>
                          <td className="px-3 py-2 text-slate-400">{r.bestMonth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-4 text-xs text-slate-600">No seasonality summary available.</p>
                )}
              </div>
            </div>
          </div>
        </ResizableChartCard>
      </section>
        </>
      ) : null}
    </div>
  );
}

const RAD = Math.PI / 180;

function PieSliceLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  name,
  percent,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  percent?: number;
}) {
  const cxi = Number(cx ?? 0);
  const cyi = Number(cy ?? 0);
  const r = Number(outerRadius ?? 0) + 18;
  const ang = Number(midAngle ?? 0);
  const p = Number(percent ?? 0);
  const x = cxi + r * Math.cos(-ang * RAD);
  const y = cyi + r * Math.sin(-ang * RAD);
  return (
    <text
      x={x}
      y={y}
      fill="#e2e8f0"
      textAnchor={x > cxi ? "start" : "end"}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={500}
    >
      {`${truncate(String(name ?? ""), 14)} ${(p * 100).toFixed(0)}%`}
    </text>
  );
}

function Kpi({
  label,
  value,
  sub,
  trendPct,
  trendLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  trendPct?: number | null;
  trendLabel?: string;
}) {
  const hasTrend = trendPct != null && Number.isFinite(trendPct);
  const positive = (trendPct ?? 0) >= 0;
  const arrow = positive ? "↑" : "↓";
  const trendText = hasTrend ? `${arrow} ${Math.abs(trendPct ?? 0).toFixed(1)}% ${trendLabel ?? ""}`.trim() : null;
  return (
    <div className="flex flex-col justify-between rounded-lg border border-slate-700/80 bg-slate-900/30 p-4 text-left">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {trendText ? (
        <p className={`mt-1 text-[11px] font-medium ${positive ? "text-emerald-400" : "text-rose-400"}`}>{trendText}</p>
      ) : null}
      {sub ? <p className="mt-1 text-[10px] text-slate-600">{sub}</p> : null}
    </div>
  );
}

function EmptyChart() {
  return <p className="flex h-full items-center justify-center text-sm text-slate-600">No data for this view.</p>;
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

/** Revenue without currency symbol (compact) */
function fmtRevenuePlain(n: number) {
  if (!Number.isFinite(n)) return "—";
  return fmtCompact(n);
}

function formatPeakMonth(raw: string): string {
  if (!raw || raw === "—") return "—";
  return formatPeriodLabel(raw);
}

function fmtInt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

function fmtCompact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
