import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Layers, Megaphone, Search, Sparkles, Store } from "lucide-react";
import {
  fetchRecommendationSummary,
  fetchRecommendations,
  fetchStoreSpendHistory,
  fetchStores,
  fetchSummary,
  postExplainRecommendation,
  postInsightStore,
  type InsightPayload,
  type RecommendationSummary,
} from "../api";
import { AIInsightCard } from "../components/AIInsightCard";
import { PromotionStrategyPanel } from "../components/PromotionStrategyPanel";
import { StoreRecommendationCard } from "../components/StoreRecommendationCard";

type PromoAdjustmentRow = {
  sku: string;
  product: string;
  currentPromo: string;
  recommendedAdjustment: string;
  expectedLift: string;
  marginSafe: "Yes" | "Review";
};

function formatSpendPeriod(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})/);
  if (!m) return ym;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export function StorePage() {
  const [searchParams] = useSearchParams();
  const [stores, setStores] = useState<string[]>([]);
  const [storeId, setStoreId] = useState("");
  const [clusterId, setClusterId] = useState<number>(0);
  const [recs, setRecs] = useState<Record<string, unknown>[]>([]);
  const [recSummary, setRecSummary] = useState<RecommendationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightErr, setInsightErr] = useState<string | null>(null);
  const [whyText, setWhyText] = useState<string | null>(null);
  const [whySku, setWhySku] = useState<string | null>(null);
  const [explainingSku, setExplainingSku] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [spendSeries, setSpendSeries] = useState<Array<{ period: string; spend: number }>>([]);
  const [spendLoading, setSpendLoading] = useState(false);
  const [detailSku, setDetailSku] = useState<string | null>(null);

  const storeOverviewRef = useRef<HTMLElement>(null);
  const recommendationsDetailRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);

  const selectDetailSku = (sku: string) => {
    setDetailSku(sku);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recommendationsDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  useEffect(() => {
    fetchStores()
      .then((r) => setStores(r.stores))
      .catch(() => setStores([]));
    fetchSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  const fromQuery = searchParams.get("store");
  useEffect(() => {
    if (fromQuery) {
      setStoreId(fromQuery);
      void loadStore(fromQuery);
    }
  }, [fromQuery]);

  useEffect(() => {
    if (!pendingScrollRef.current || !recs.length) return;
    pendingScrollRef.current = false;
    const t = window.setTimeout(() => {
      storeOverviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(t);
  }, [recs]);

  useEffect(() => {
    if (!recs.length) {
      setDetailSku(null);
      return;
    }
    const first = String(recs[0].SKU_CODE ?? "");
    setDetailSku((prev) => {
      if (prev && recs.some((r) => String(r.SKU_CODE ?? "") === prev)) return prev;
      return first || null;
    });
  }, [recs]);

  const filtered = useMemo(
    () =>
      stores.filter((s) => s.toLowerCase().includes(storeId.trim().toLowerCase())).slice(0, 50),
    [stores, storeId],
  );

  const topCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recs) {
      const c = String(r.CATEGORY ?? "");
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [recs]);

  /** Fallback when /summary fails but we have rows */
  const displaySummary = useMemo((): RecommendationSummary | null => {
    if (recSummary) return recSummary;
    if (!recs.length) return null;
    let amt = 0;
    let vol = 0;
    let maxC = 0;
    for (const r of recs) {
      amt += Number(r.FINAL_ADJUSTED_AMT ?? 0);
      vol += Number(r.VOLUME ?? 0);
      const c = Number(r.CONFIDENCE ?? 0);
      if (Number.isFinite(c) && c > maxC) maxC = c;
    }
    return {
      store_id: storeId,
      cluster_id: clusterId,
      total_recommendations: recs.length,
      total_estimated_amount: amt,
      total_volume: Math.round(vol),
      top_confidence: maxC || null,
    };
  }, [recSummary, recs, storeId, clusterId]);

  async function loadStore(id: string) {
    if (!id) return;
    setLoading(true);
    setErr(null);
    setInsight(null);
    setWhyText(null);
    setWhySku(null);
    setRecSummary(null);
    try {
      const [data, sum] = await Promise.all([
        fetchRecommendations(id),
        fetchRecommendationSummary(id).catch(() => null),
      ]);
      const rows = (data.recommendations as Record<string, unknown>[]) ?? [];
      setRecs(rows);
      setClusterId(Number(data.cluster_id ?? 0));
      setStoreId(String(data.store_id ?? id));
      setRecSummary(sum);
      pendingScrollRef.current = rows.length > 0;

      setSpendLoading(true);
      fetchStoreSpendHistory(String(data.store_id ?? id))
        .then((h) => setSpendSeries(h.series ?? []))
        .catch(() => setSpendSeries([]))
        .finally(() => setSpendLoading(false));

      setInsightLoading(true);
      setInsightErr(null);
      try {
        const ai = await postInsightStore(String(data.store_id ?? id));
        setInsight(ai.insight);
      } catch (e) {
        setInsightErr(e instanceof Error ? e.message : String(e));
      } finally {
        setInsightLoading(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRecs([]);
      setClusterId(0);
      setSpendSeries([]);
    } finally {
      setLoading(false);
    }
  }

  const explain = async (sku: string) => {
    if (!storeId) return;
    setExplainingSku(sku);
    setWhySku(sku);
    setWhyText(null);
    try {
      const r = await postExplainRecommendation(storeId, sku);
      setWhyText(r.explanation);
    } catch (e) {
      setWhyText(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainingSku(null);
    }
  };

  const fmtMoney = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  };

  const fmtInrCompact = (n: number) => {
    const abs = Math.abs(n);
    if (!Number.isFinite(abs)) return "INR 0";
    if (abs >= 1e7) return `INR ${(n / 1e7).toFixed(1)}Cr`;
    if (abs >= 1e5) return `INR ${(n / 1e5).toFixed(1)}L`;
    if (abs >= 1e3) return `INR ${Math.round(n / 1e3)}K`;
    return `INR ${Math.round(n)}`;
  };

  const spendChartData = useMemo(
    () => spendSeries.map((s) => ({ month: formatSpendPeriod(s.period), spend: s.spend })),
    [spendSeries],
  );

  const selectedRec = useMemo(() => {
    if (!detailSku || !recs.length) return null;
    return recs.find((r) => String(r.SKU_CODE ?? "") === detailSku) ?? null;
  }, [recs, detailSku]);

  const selectedRecIndex = useMemo(() => {
    if (!detailSku) return -1;
    return recs.findIndex((r) => String(r.SKU_CODE ?? "") === detailSku);
  }, [recs, detailSku]);

  const promoRows = useMemo<PromoAdjustmentRow[]>(() => {
    return recs.slice(0, 20).map((r) => {
      const sku = String(r.SKU_CODE ?? "—");
      const product = String(r.PRODUCT_NAME ?? "—");
      const source = String(r.SOURCE ?? "Unknown");
      const conf = Number(r.CONFIDENCE ?? 0);
      const promoM = Number(r.PROMOTIONAL_MULTIPLIER ?? 1);
      const forecasted = Number(r.FORECASTED_AMT ?? 0);
      const finalAmt = Number(r.FINAL_ADJUSTED_AMT ?? 0);

      const pctDelta =
        Number.isFinite(forecasted) && Math.abs(forecasted) > 1e-6
          ? ((finalAmt - forecasted) / forecasted) * 100
          : Number.NaN;

      const discountPct = Number.isFinite(promoM) ? Math.max(0, (1 - promoM) * 100) : 0;
      const currentPromo = discountPct >= 2 ? `Flat ${Math.round(discountPct)}%` : "None";

      let recommendedAdjustment = "Maintain base promo + improve shelf visibility";
      if (source === "ALS") {
        recommendedAdjustment = "Bundle with companion SKU @ -5% combo";
      } else if (source === "FPG") {
        recommendedAdjustment = "Checkout cross-sell with paired product";
      } else if (source === "POPULARITY") {
        recommendedAdjustment = "Shift to Buy 2 Get 8% tiered offer";
      }
      if (Number.isFinite(conf) && conf < 0.5) {
        recommendedAdjustment = "Pilot 7-day discount before full rollout";
      }

      const amtLift =
        Number.isFinite(finalAmt) && Number.isFinite(forecasted) ? finalAmt - forecasted : Number.NaN;
      const expectedLift = Number.isFinite(amtLift)
        ? `${amtLift >= 0 ? "+" : "-"}${fmtInrCompact(Math.abs(amtLift))}`
        : Number.isFinite(pctDelta)
          ? `${pctDelta >= 0 ? "+" : ""}${pctDelta.toFixed(1)}%`
          : "Pending";

      const marginSafe: PromoAdjustmentRow["marginSafe"] =
        (Number.isFinite(promoM) ? promoM : 1) >= 0.9 && (Number.isFinite(conf) ? conf : 0) >= 0.45 ? "Yes" : "Review";

      return {
        sku,
        product,
        currentPromo,
        recommendedAdjustment,
        expectedLift,
        marginSafe,
      };
    });
  }, [recs]);

  return (
    <div className="space-y-10 pb-8">
      {/* 1. Store search */}
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-100">Recommendations</h1>
        <p className="mt-1 max-w-2xl text-slate-400">
          Search a location, review prioritized SKUs, and move from insight to promotion with a clear layout.
        </p>
      </header>

      <section className="rounded-2xl border border-surface-border bg-surface-card p-5">
        <div className="flex items-center gap-2 text-slate-300">
          <Search className="h-5 w-5 text-accent" />
          <h2 className="font-display text-lg font-semibold">Store search</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Type or pick a store ID and press Load. The list below narrows as you type.
        </p>
        <label
          htmlFor="store-id-input"
          className="mt-4 block text-xs font-semibold uppercase text-slate-500"
        >
          Store ID
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="store-id-input"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && storeId.trim() && !loading) {
                loadStore(storeId.trim());
              }
            }}
            placeholder="e.g. S01001"
            className="min-w-[200px] flex-1 rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => loadStore(storeId)}
            disabled={loading || !storeId.trim()}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-dim disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load store"}
          </button>
        </div>
        <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-surface-border">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">No matching store IDs.</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => loadStore(s)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-raised"
              >
                <Store className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                {s}
              </button>
            ))
          )}
        </div>
      </section>

      {err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{err}</div>
      ) : null}

      {/* 2. Store overview — scroll target after load */}
      {recs.length > 0 && displaySummary ? (
        <section
          ref={storeOverviewRef}
          className="scroll-mt-24 rounded-2xl border border-surface-border bg-surface-card p-5"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-mint" />
            <h2 className="font-display text-lg font-semibold text-slate-100">Store overview</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">Snapshot for this store&apos;s recommendation file.</p>
          <div className="mt-4 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase text-slate-500">Store</dt>
              <dd className="mt-1 font-mono text-sm text-slate-200">{displaySummary.store_id}</dd>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <Layers className="h-3 w-3" />
                Cluster
              </dt>
              <dd className="mt-1 text-lg font-semibold text-slate-100">
                {displaySummary.cluster_id ?? clusterId}
              </dd>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase text-slate-500">Recommendations</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-100">{displaySummary.total_recommendations}</dd>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase text-slate-500">Est. total value</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-mint">
                {fmtMoney(displaySummary.total_estimated_amount ?? null)}
              </dd>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase text-slate-500">Total volume (units)</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                {displaySummary.total_volume != null ? displaySummary.total_volume.toLocaleString() : "—"}
              </dd>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
              <dt className="text-[10px] font-semibold uppercase text-slate-500">Top confidence</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-sky-300">
                {displaySummary.top_confidence != null ? displaySummary.top_confidence.toFixed(3) : "—"}
              </dd>
            </div>
            {topCat ? (
              <div className="rounded-xl border border-surface-border bg-surface/50 px-4 py-3 sm:col-span-2 lg:col-span-3">
                <dt className="text-[10px] font-semibold uppercase text-slate-500">Top category (by line count)</dt>
                <dd className="mt-1 text-sm font-medium text-slate-200">{topCat}</dd>
              </div>
            ) : null}
            </dl>

            <section className="rounded-xl border border-surface-border bg-surface/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-100">Store purchase trend</h3>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">Last up to 6 months</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Monthly spend from transaction history to identify growth or decline before pitching.
              </p>
              <div className="mt-3 h-52">
                {spendLoading ? (
                  <p className="flex h-full items-center justify-center text-sm text-slate-500">Loading history…</p>
                ) : spendChartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={spendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} stroke="#475569" />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#94a3b8" }}
                        stroke="#475569"
                        tickFormatter={(v) => {
                          const n = Number(v);
                          if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
                          if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
                          return String(Math.round(n));
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#12171f",
                          border: "1px solid #2a3344",
                          borderRadius: "8px",
                          color: "#e2e8f0",
                        }}
                        formatter={(value: number) => [fmtInrCompact(Number(value)), "Spend"]}
                      />
                      <defs>
                        <linearGradient id="storeSpendFillOverview" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="spend"
                        stroke="#38bdf8"
                        fill="url(#storeSpendFillOverview)"
                        strokeWidth={2}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-xs text-slate-500">
                    No transaction history for this store.
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {/* 3. Recommendations — master-detail: summary table + one expanded card */}
      <section className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-100">Recommendations</h2>
            <p className="mt-1 text-xs text-slate-500">
              Scan the table, then click a row to open full detail (forecast, volume, AI explanation).
            </p>
          </div>
        </div>
        {recs.length ? (
          <div className="space-y-6">
            <div className="overflow-x-auto rounded-xl border border-surface-border">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-surface-raised/40 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Source</th>
                    <th className="px-3 py-2 text-right">Est. value</th>
                    <th className="px-3 py-2 text-right">Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((r, i) => {
                    const sku = String(r.SKU_CODE ?? "");
                    const active = detailSku === sku;
                    const conf = Number(r.CONFIDENCE ?? 0);
                    const val = Number(r.FINAL_ADJUSTED_AMT ?? 0);
                    const rk = Number(r.RANK ?? i + 1);
                    return (
                      <tr
                        key={`${sku}-${i}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectDetailSku(sku)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectDetailSku(sku);
                          }
                        }}
                        className={`cursor-pointer border-t border-surface-border/70 transition hover:bg-surface-raised/50 ${
                          active ? "bg-accent/10" : ""
                        }`}
                      >
                        <td className="px-3 py-2 tabular-nums text-slate-300">{Number.isFinite(rk) ? Math.round(rk) : i + 1}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-100">
                          {String(r.PRODUCT_NAME ?? "—")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{sku}</td>
                        <td className="max-w-[120px] truncate px-3 py-2 text-slate-400">{String(r.CATEGORY ?? "—")}</td>
                        <td className="px-3 py-2 text-accent">{String(r.SOURCE ?? "—")}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-mint">{fmtMoney(val)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                          {Number.isFinite(conf) ? conf.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedRec && selectedRecIndex >= 0 ? (
              <div ref={recommendationsDetailRef} className="scroll-mt-28">
                <StoreRecommendationCard
                  rec={selectedRec}
                  clusterId={clusterId}
                  index={selectedRecIndex}
                  onDeepExplain={explain}
                  deepExplanation={whySku === String(selectedRec.SKU_CODE ?? "") ? whyText : null}
                  explainingSku={explainingSku}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-surface-border bg-surface-card/50 p-10 text-center text-sm text-slate-500">
            Load a store to see prioritized SKUs here.
          </div>
        )}
      </section>

      {/* 4. Promotional adjustments (product-level) */}
      {promoRows.length ? (
        <section className="rounded-2xl border border-surface-border bg-surface-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-amber-400" />
            <h2 className="font-display text-lg font-semibold text-slate-100">Promotional adjustments</h2>
          </div>
          <p className="mb-4 max-w-3xl text-xs leading-relaxed text-slate-500">
            Product-level action table for this store: current promo state, recommended adjustment, expected lift, and
            guardrail checks. Showing top 20 prioritized lines.
          </p>
          <div className="overflow-x-auto rounded-xl border border-surface-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface-raised/40 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Current promo</th>
                  <th className="px-3 py-2 text-left">Recommended adjustment</th>
                  <th className="px-3 py-2 text-left">Expected lift</th>
                  <th className="px-3 py-2 text-left">Margin safe</th>
                </tr>
              </thead>
              <tbody>
                {promoRows.map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`} className="border-t border-surface-border/70 text-slate-200">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-100">{row.product}</p>
                      <p className="font-mono text-[11px] text-slate-500">{row.sku}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.currentPromo}</td>
                    <td className="px-3 py-2 text-slate-200">{row.recommendedAdjustment}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-slate-800/80 px-2 py-1 font-semibold tabular-nums text-mint">
                        {row.expectedLift}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          row.marginSafe === "Yes"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {row.marginSafe === "Yes" ? "Yes" : "No (risk)"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* 5. Recommendation agent */}
      {recs.length ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <h2 className="font-display text-lg font-semibold text-slate-100">Recommendation agent</h2>
          </div>
          <p className="mb-4 text-xs text-slate-500">What to do next — prioritized actions for this store.</p>
          <AIInsightCard
            title="Recommendation agent — what to do next"
            insight={insight}
            loading={insightLoading}
            error={insightErr}
          />
        </section>
      ) : null}

      {/* 6. Promotion strategy */}
      {recs.length ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-amber-400" />
            <h2 className="font-display text-lg font-semibold text-slate-100">Promotion strategy agent</h2>
          </div>
          <p className="mb-4 max-w-3xl text-xs leading-relaxed text-slate-500">
            One playbook for this store (not per SKU): the first idea reacts to your ALS vs FPG vs popularity mix;
            the rest are network-level promotion patterns. It updates when you load a different store or when
            pipeline data changes.
          </p>
          <PromotionStrategyPanel
            summary={summary}
            focusCategory={topCat}
            recommendations={recs}
            storeValueBase={displaySummary?.total_estimated_amount ?? null}
          />
        </section>
      ) : null}
    </div>
  );
}
