import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchForecastSimulate,
  fetchRecommendationsBySku,
  fetchSeasonalityByCategory,
  fetchSkuSearch,
} from "../api";
import {
  DEFAULT_SCENARIO_BETA,
  discountAdjustment,
  forecastVolumeFromComponents,
  signalFor,
  signalLabel,
} from "../lib/forecastFormula";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Store dropdown: aggregate network view */
const ALL_STORES_VALUE = "__ALL__";

function fmtInr(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtInrDec(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

type SimResult = Awaited<ReturnType<typeof fetchForecastSimulate>>;

export function ForecastSimulator() {
  const [productQ, setProductQ] = useState("");
  /** True only while the product list is open (after focusing the search field). No fetch until then. */
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [skuList, setSkuList] = useState<Array<{ SKU_CODE: string; PRODUCT_NAME: string }>>([]);
  const [sku, setSku] = useState("");
  const [productName, setProductName] = useState("");
  const [l2, setL2] = useState("");
  const [bySkuRows, setBySkuRows] = useState<Record<string, unknown>[]>([]);
  const [storeId, setStoreId] = useState(ALL_STORES_VALUE);
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [discount, setDiscount] = useState(0);
  const [loadingSkus, setLoadingSkus] = useState(false);
  const [loadingBySku, setLoadingBySku] = useState(false);
  const [loadingSim, setLoadingSim] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [season, setSeason] = useState<Awaited<ReturnType<typeof fetchSeasonalityByCategory>> | null>(null);
  const productSearchContainerRef = useRef<HTMLDivElement>(null);

  /** Close product list when clicking outside the search + dropdown area. */
  useEffect(() => {
    if (!isSearchingProduct) return;
    const handlePointerDown = (e: PointerEvent) => {
      const node = productSearchContainerRef.current;
      if (!node?.contains(e.target as Node)) {
        setIsSearchingProduct(false);
        setProductQ("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isSearchingProduct]);

  useEffect(() => {
    if (!isSearchingProduct) {
      setSkuList([]);
      return;
    }
    const t = window.setTimeout(() => {
      setLoadingSkus(true);
      fetchSkuSearch(productQ)
        .then((r) => setSkuList(r.skus ?? []))
        .catch(() => setSkuList([]))
        .finally(() => setLoadingSkus(false));
    }, productQ.trim() ? 320 : 0);
    return () => window.clearTimeout(t);
  }, [productQ, isSearchingProduct]);

  const loadBySku = useCallback((code: string) => {
    if (!code) {
      setBySkuRows([]);
      setL2("");
      setProductName("");
      return;
    }
    setLoadingBySku(true);
    setErr(null);
    fetchRecommendationsBySku(code)
      .then((d) => {
        setBySkuRows(d.recommendations ?? []);
        setL2(d.l2_category ?? "");
        setProductName(d.product_name ?? "");
        setStoreId((prev) => {
          if (prev === ALL_STORES_VALUE) return ALL_STORES_VALUE;
          const stores = (d.recommendations ?? []).map((r) => String(r.STORE_ID ?? ""));
          if (prev && stores.includes(prev)) return prev;
          return ALL_STORES_VALUE;
        });
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : String(e));
        setBySkuRows([]);
      })
      .finally(() => setLoadingBySku(false));
  }, []);

  useEffect(() => {
    if (!sku) {
      setBySkuRows([]);
      setSim(null);
      setSeason(null);
      setL2("");
      setProductName("");
      return;
    }
    loadBySku(sku);
  }, [sku, loadBySku]);

  useEffect(() => {
    if (!l2) {
      setSeason(null);
      return;
    }
    let cancelled = false;
    fetchSeasonalityByCategory(l2)
      .then((s) => {
        if (!cancelled) setSeason(s);
      })
      .catch(() => {
        if (!cancelled) setSeason(null);
      });
    return () => {
      cancelled = true;
    };
  }, [l2]);

  useEffect(() => {
    if (!sku || storeId === ALL_STORES_VALUE || !storeId) {
      setSim(null);
      return;
    }
    let cancelled = false;
    setLoadingSim(true);
    setErr(null);
    fetchForecastSimulate({
      store_id: storeId,
      sku_code: sku,
      month,
      discount_pct: discount,
    })
      .then((r) => {
        if (!cancelled) setSim(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setSim(null);
          setErr(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSim(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, sku, month, discount]);

  const storeOptions = useMemo(() => {
    const ids = [...new Set(bySkuRows.map((r) => String(r.STORE_ID ?? "")))].filter(Boolean).sort();
    return ids;
  }, [bySkuRows]);

  const allStoresTable = useMemo(() => {
    if (!season || !bySkuRows.length) return [];
    const mult = Number(season.multipliers[String(month)] ?? 1);
    const discAdj = discountAdjustment(DEFAULT_SCENARIO_BETA, discount);
    return bySkuRows.map((r) => {
      const base = Number(r.FORECASTED_AMT ?? 0);
      const promo = Number(r.PROMOTIONAL_MULTIPLIER ?? 1) || 1;
      const mrp = Number(r.MAX_LIST_PRICE ?? 0) || 1;
      const vol = forecastVolumeFromComponents(base, mult, promo, discAdj, mrp);
      const amtAfter = base * mult;
      const adj = amtAfter * promo;
      const finalA = adj * discAdj;
      return {
        storeId: String(r.STORE_ID ?? ""),
        base,
        amtAfter,
        adj,
        finalA,
        vol,
        mrp,
        pipelineVol: Number(r.VOLUME ?? 0),
      };
    });
  }, [bySkuRows, season, month, discount]);

  /** Aggregated “single-store style” totals for All stores (same formulas, summed across recommendation rows). */
  const networkTotals = useMemo(() => {
    if (!allStoresTable.length || !season) return null;
    let sumBase = 0;
    let sumAmtAfter = 0;
    let sumAdj = 0;
    let sumFinal = 0;
    let sumVol = 0;
    let sumMrpBase = 0;
    for (const row of allStoresTable) {
      sumBase += row.base;
      sumAmtAfter += row.amtAfter;
      sumAdj += row.adj;
      sumFinal += row.finalA;
      sumVol += row.vol;
      sumMrpBase += row.mrp * row.base;
    }
    const discAdj = discountAdjustment(DEFAULT_SCENARIO_BETA, discount);
    const blendedPromo = sumAmtAfter > 0 ? sumAdj / sumAmtAfter : 1;
    const avgSeasonMult = sumBase > 0 ? sumAmtAfter / sumBase : 1;
    const mrpWeighted = sumBase > 0 ? sumMrpBase / sumBase : allStoresTable[0].mrp;
    const mult = Number(season.multipliers[String(month)] ?? 1);
    const sig = signalFor(mult, season.best_month, month);
    return {
      sumBase,
      sumAmtAfter,
      sumAdj,
      sumFinal,
      sumVol,
      discAdj,
      blendedPromo,
      avgSeasonMult,
      mrpWeighted,
      mult,
      sig,
    };
  }, [allStoresTable, season, month, discount]);

  const networkMonthlyRows = useMemo(() => {
    if (!season || !bySkuRows.length) return [];
    const discAdj = discountAdjustment(DEFAULT_SCENARIO_BETA, discount);
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
      const mult = Number(season.multipliers[String(m)] ?? 1);
      let finalAmt = 0;
      let vol = 0;
      for (const r of bySkuRows) {
        const base = Number(r.FORECASTED_AMT ?? 0);
        const promo = Number(r.PROMOTIONAL_MULTIPLIER ?? 1) || 1;
        const mrp = Number(r.MAX_LIST_PRICE ?? 0) || 1;
        const amtAfter = base * mult;
        const adj = amtAfter * promo;
        finalAmt += adj * discAdj;
        vol += forecastVolumeFromComponents(base, mult, promo, discAdj, mrp);
      }
      const sig = signalFor(mult, season.best_month, m);
      return { m, mult, finalAmt, volume: vol, sig };
    });
  }, [bySkuRows, season, discount]);

  const lockedProductDisplay =
    sku && productName
      ? `${sku} — ${productName.slice(0, 80)}${productName.length > 80 ? "…" : ""}`
      : sku || "";

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-surface-border bg-surface-card p-5">
        <h2 className="font-display text-xl font-semibold tracking-tight text-white">Scenario analysis</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          Search by product, choose <strong className="font-medium text-slate-300">All stores</strong> or a specific
          location, then set month and discount. Amounts follow the pipeline: base forecast × seasonality × promotional
          multiplier × discount scenario; suggested quantity ≈ projected value ÷ unit list price.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <div
            ref={productSearchContainerRef}
            className="flex max-w-xl flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Product
            <input
              type="search"
              readOnly={Boolean(sku) && !isSearchingProduct}
              title={
                sku && !isSearchingProduct
                  ? "Click or focus to open the product list. Your current analysis stays until you pick another product."
                  : "Focus to load the product list, then type to filter."
              }
              value={isSearchingProduct ? productQ : lockedProductDisplay}
              onChange={(e) => setProductQ(e.target.value)}
              onFocus={() => {
                setIsSearchingProduct(true);
                setProductQ("");
              }}
              placeholder={
                sku && !isSearchingProduct
                  ? "Click to change product (current results stay until you select another)…"
                  : "Click or focus here to load products, then type to filter…"
              }
              className={`rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-slate-100 ${
                sku && !isSearchingProduct ? "cursor-pointer hover:border-slate-500" : ""
              }`}
            />
            {isSearchingProduct ? (
              <>
                {loadingSkus ? (
                  <span className="text-[11px] text-slate-500">Loading products…</span>
                ) : skuList.length > 0 ? (
                  <select
                    value={sku}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        setIsSearchingProduct(false);
                        setProductQ("");
                        return;
                      }
                      setSku(v);
                      setIsSearchingProduct(false);
                      setProductQ("");
                    }}
                    className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-slate-100"
                    size={Math.min(8, skuList.length + 1)}
                  >
                    <option value="">Select a product…</option>
                    {skuList.map((s) => (
                      <option key={s.SKU_CODE} value={s.SKU_CODE}>
                        {s.SKU_CODE} — {s.PRODUCT_NAME.slice(0, 64)}
                      </option>
                    ))}
                  </select>
                ) : productQ.trim() ? (
                  <span className="text-[11px] text-slate-500">No matches</span>
                ) : (
                  <span className="text-[11px] text-slate-500">Could not load products.</span>
                )}
              </>
            ) : null}
          </div>

          {sku ? (
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex min-w-[220px] flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Store
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  disabled={loadingBySku || !storeOptions.length}
                  className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-slate-100"
                >
                  <option value={ALL_STORES_VALUE}>All stores (aggregated)</option>
                  {storeOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex w-28 flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Month
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="rounded-lg border border-surface-border bg-surface-elevated px-2 py-1.5 text-sm text-slate-100"
                >
                  {MONTH_SHORT.map((label, i) => (
                    <option key={label} value={i + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[180px] flex-1 flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Discount %
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className="w-full accent-mint"
                />
                <span className="text-sm font-medium text-slate-200">{discount}%</span>
              </label>
            </div>
          ) : null}
        </div>

        {err ? (
          <p className="mt-3 text-sm text-amber-300">{err}</p>
        ) : null}

        {sku && storeId ? (
          <div className="mt-6 rounded-xl border border-surface-border bg-surface-elevated/50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated impact</h3>
            <div className="mt-2 rounded-lg border border-surface-border/60 bg-surface/50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Product</p>
              <p className="mt-0.5 text-sm font-medium leading-snug text-slate-100">
                {productName ? (
                  <>
                    <span className="font-mono text-mint">{sku}</span>
                    <span className="text-slate-400"> · </span>
                    <span>{productName}</span>
                  </>
                ) : (
                  <span className="font-mono text-mint">{sku}</span>
                )}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {storeId === ALL_STORES_VALUE
                  ? "Scope: all stores with this SKU in recommendations."
                  : `Scope: store ${storeId}`}
              </p>
            </div>
            {storeId === ALL_STORES_VALUE ? (
              networkTotals && season ? (
                <>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Network aggregate across all stores with this SKU (β = {DEFAULT_SCENARIO_BETA} for discount scenario).
                    Single-store view uses cluster-specific β from the API.
                  </p>
                  <NetworkBreakdown month={month} totals={networkTotals} />
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  {loadingBySku || !season ? "Loading…" : "No data for aggregation."}
                </p>
              )
            ) : loadingSim || !sim ? (
              <p className="mt-2 text-sm text-slate-500">
                {loadingSim ? "Loading…" : "Could not load simulation for this store."}
              </p>
            ) : (
              <SingleStoreBreakdown sim={sim} month={month} />
            )}
          </div>
        ) : null}

        {sku && season && storeId === ALL_STORES_VALUE && networkMonthlyRows.length ? (
          <MonthlyOutlookNetwork
            rows={networkMonthlyRows}
            discount={discount}
            bestMonth={season.best_month}
            worstMonth={season.worst_month}
            sku={sku}
            productName={productName}
            scopeLabel="All stores (aggregated)"
          />
        ) : null}

        {sku && season && storeId !== ALL_STORES_VALUE && sim ? (
          <MonthlyOutlookSection
            sim={sim}
            season={season}
            discount={discount}
            mrp={sim.max_list_price}
            sku={sku}
            productName={productName}
            storeId={storeId}
          />
        ) : null}

        {season ? (
          <section className="mt-6 rounded-xl border border-surface-border bg-surface-elevated/30 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Model coverage</h3>
            {season.history_span_years >= 2.75 || season.data_years_available >= 3 ? (
              <p className="mt-2 text-sm text-emerald-200/90">
                Seasonal indices use roughly three years of history (span {season.history_span_years} yr).
              </p>
            ) : (
              <p className="mt-2 text-sm text-amber-200/90">
                Historical span is shorter than a full three-year window; indices are still usable.
              </p>
            )}
          </section>
        ) : null}
      </section>
    </div>
  );
}

function NetworkBreakdown({
  month,
  totals,
}: {
  month: number;
  totals: {
    sumBase: number;
    sumAmtAfter: number;
    sumAdj: number;
    sumFinal: number;
    sumVol: number;
    discAdj: number;
    blendedPromo: number;
    avgSeasonMult: number;
    mrpWeighted: number;
    mult: number;
    sig: "best" | "push" | "wait";
  };
}) {
  const t = totals;
  return (
    <div className="mt-3 space-y-2 text-sm text-slate-200">
      <div className="flex flex-wrap justify-between gap-2 border-b border-surface-border pb-2">
        <span className="text-slate-400">Base value</span>
        <span className="tabular-nums">{fmtInrDec(t.sumBase)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="max-w-[70%] text-slate-400">
          After seasonal adjustments ({MONTH_SHORT[month - 1]}: ×{t.avgSeasonMult.toFixed(4)} blended multiplier)
        </span>
        <span className="tabular-nums">{fmtInrDec(t.sumAmtAfter)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-slate-400">
          × Promotional multiplier <span className="text-slate-500">×{t.blendedPromo.toFixed(4)}</span> (blended)
        </span>
        <span className="tabular-nums">{fmtInrDec(t.sumAdj)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-slate-400">
          × Discount scenario <span className="text-slate-500">×{t.discAdj.toFixed(4)}</span>
        </span>
        <span className="tabular-nums">{fmtInrDec(t.sumFinal)}</span>
      </div>
      <div className="my-3 border-t border-dashed border-slate-600" />
      <div className="flex flex-wrap justify-between gap-2 font-semibold text-white">
        <span>Projected value</span>
        <span className="tabular-nums">{fmtInrDec(t.sumFinal)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-slate-400">
        <span>Unit list price (base-weighted MRP)</span>
        <span className="tabular-nums text-slate-300">{fmtInrDec(t.mrpWeighted)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-surface-border pt-3 text-base font-medium text-mint">
        <span>Suggested quantity</span>
        <span className="tabular-nums">{t.sumVol} units</span>
      </div>
      <p className="pt-2 text-xs text-slate-500">
        Outlook: <span className="text-slate-400">{signalLabel(t.sig)}</span>
      </p>
    </div>
  );
}

function MonthlyOutlookNetwork({
  rows,
  discount,
  bestMonth,
  worstMonth,
  sku,
  productName,
  scopeLabel,
}: {
  rows: Array<{
    m: number;
    mult: number;
    finalAmt: number;
    volume: number;
    sig: "best" | "push" | "wait";
  }>;
  discount: number;
  bestMonth: number;
  worstMonth: number;
  sku: string;
  productName: string;
  scopeLabel: string;
}) {
  const todayMonth = new Date().getMonth() + 1;
  return (
    <section className="mt-6 rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">Monthly outlook</h2>
      <div className="mt-3 rounded-lg border border-surface-border/60 bg-surface/50 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Applies to</p>
        <p className="mt-0.5 text-sm font-medium text-slate-100">
          <span className="font-mono text-mint">{sku}</span>
          {productName ? (
            <>
              <span className="text-slate-400"> · </span>
              <span>{productName}</span>
            </>
          ) : null}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">{scopeLabel}</p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Month varies; discount fixed at {discount}%. Blended promotional multipliers; β = {DEFAULT_SCENARIO_BETA} for
        discount.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-slate-500">
              <th className="py-2 pr-3 font-medium">Month</th>
              <th className="py-2 pr-3 font-medium">Seasonal index</th>
              <th className="py-2 pr-3 font-medium">Projected value</th>
              <th className="py-2 pr-3 font-medium">Quantity</th>
              <th className="py-2 font-medium">Outlook</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isBest = row.m === bestMonth;
              const isWorst = row.m === worstMonth;
              const isCurrentCal = row.m === todayMonth;
              let rowClass = "border-b border-surface-border/60";
              if (isBest) rowClass += " bg-emerald-950/40";
              else if (isWorst) rowClass += " bg-red-950/30";
              else if (isCurrentCal) rowClass += " bg-teal-950/35";
              return (
                <tr key={row.m} className={rowClass}>
                  <td className="py-2 pr-3 text-slate-200">{MONTH_SHORT[row.m - 1]}</td>
                  <td className="py-2 pr-3 font-mono text-slate-300">{row.mult.toFixed(2)}</td>
                  <td className="py-2 pr-3">{fmtInr(row.finalAmt)}</td>
                  <td className="py-2 pr-3">{row.volume} units</td>
                  <td className="py-2 text-slate-300">{signalLabel(row.sig)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SingleStoreBreakdown({
  sim,
  month,
}: {
  sim: SimResult;
  month: number;
}) {
  const mult = sim.seasonality_factor;
  const amtAfter = sim.amt_after_seasonality;
  const promo = sim.promotional_multiplier;
  const adj = sim.adjusted_forecast_amt;
  return (
    <div className="mt-3 space-y-2 text-sm text-slate-200">
      <div className="flex flex-wrap justify-between gap-2 border-b border-surface-border pb-2">
        <span className="text-slate-400">Base value</span>
        <span className="tabular-nums">{fmtInrDec(sim.base_forecast_amt)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="max-w-[70%] text-slate-400">
          After seasonal adjustments ({MONTH_SHORT[month - 1]}: ×{mult.toFixed(4)} seasonal multiplier)
        </span>
        <span className="tabular-nums">{fmtInrDec(amtAfter)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-slate-400">
          × Promotional multiplier <span className="text-slate-500">×{promo.toFixed(4)}</span>
        </span>
        <span className="tabular-nums">{fmtInrDec(adj)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-slate-400">
          × Discount scenario <span className="text-slate-500">×{sim.discount_adjustment.toFixed(4)}</span>
        </span>
        <span className="tabular-nums">{fmtInrDec(sim.final_adjusted_amt)}</span>
      </div>
      <div className="my-3 border-t border-dashed border-slate-600" />
      <div className="flex flex-wrap justify-between gap-2 font-semibold text-white">
        <span>Projected value</span>
        <span className="tabular-nums">{fmtInrDec(sim.final_adjusted_amt)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-slate-400">
        <span>Unit list price (max MRP for SKU in data)</span>
        <span className="tabular-nums text-slate-300">{fmtInrDec(sim.max_list_price)}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-surface-border pt-3 text-base font-medium text-mint">
        <span>Suggested quantity</span>
        <span className="tabular-nums">{sim.volume} units</span>
      </div>
      <p className="pt-2 text-xs text-slate-500">
        Outlook:{" "}
        <span className="text-slate-400">
          {signalLabel(sim.signal === "best" || sim.signal === "push" || sim.signal === "wait" ? sim.signal : "push")}
        </span>
      </p>
    </div>
  );
}

function MonthlyOutlookSection({
  sim,
  season,
  discount,
  mrp,
  sku,
  productName,
  storeId,
}: {
  sim: SimResult;
  season: Awaited<ReturnType<typeof fetchSeasonalityByCategory>>;
  discount: number;
  mrp: number;
  sku: string;
  productName: string;
  storeId: string;
}) {
  const beta = sim.price_elasticity_beta;
  const promo = sim.promotional_multiplier;
  const base = sim.base_forecast_amt;
  const discAdj = discountAdjustment(beta, discount);
  const todayMonth = new Date().getMonth() + 1;

  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
    const mult = Number(season.multipliers[String(m)] ?? 1);
    const amtAfter = base * mult;
    const adj = amtAfter * promo;
    const finalAmt = adj * discAdj;
    const vol = forecastVolumeFromComponents(base, mult, promo, discAdj, mrp);
    const sig = signalFor(mult, season.best_month, m);
    return { m, mult, finalAmt, volume: vol, sig, todayMonth };
  });

  return (
    <section className="mt-6 rounded-2xl border border-surface-border bg-surface-card p-5">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white">Monthly outlook</h2>
      <div className="mt-3 rounded-lg border border-surface-border/60 bg-surface/50 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Applies to</p>
        <p className="mt-0.5 text-sm font-medium text-slate-100">
          <span className="font-mono text-mint">{sku}</span>
          {productName ? (
            <>
              <span className="text-slate-400"> · </span>
              <span>{productName}</span>
            </>
          ) : null}
        </p>
        <p className="mt-1 font-mono text-[11px] text-slate-400">Store {storeId}</p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        Month varies for this store; discount fixed at {discount}%. Uses pipeline promotional multiplier for this SKU ×
        cluster.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-surface-border text-slate-500">
              <th className="py-2 pr-3 font-medium">Month</th>
              <th className="py-2 pr-3 font-medium">Seasonal index</th>
              <th className="py-2 pr-3 font-medium">Projected value</th>
              <th className="py-2 pr-3 font-medium">Quantity</th>
              <th className="py-2 font-medium">Outlook</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isBest = row.m === season.best_month;
              const isWorst = row.m === season.worst_month;
              const isCurrentCal = row.m === row.todayMonth;
              let rowClass = "border-b border-surface-border/60";
              if (isBest) rowClass += " bg-emerald-950/40";
              else if (isWorst) rowClass += " bg-red-950/30";
              else if (isCurrentCal) rowClass += " bg-teal-950/35";
              return (
                <tr key={row.m} className={rowClass}>
                  <td className="py-2 pr-3 text-slate-200">{MONTH_SHORT[row.m - 1]}</td>
                  <td className="py-2 pr-3 font-mono text-slate-300">{row.mult.toFixed(2)}</td>
                  <td className="py-2 pr-3">{fmtInr(row.finalAmt)}</td>
                  <td className="py-2 pr-3">{row.volume} units</td>
                  <td className="py-2 text-slate-300">{signalLabel(row.sig)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
