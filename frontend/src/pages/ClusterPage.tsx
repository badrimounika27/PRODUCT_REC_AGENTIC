import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Expand, Minimize2, Search, X } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchClusterBreakdown,
  fetchClusterDetail,
  fetchClusterProfile,
  postInsightCluster,
  type ClusterProfileColumn,
  type ClusterProfileRow,
  type InsightPayload,
} from "../api";
import { ClusterExplanationCard } from "../components/ClusterExplanationCard";
import { ClusterProfileHeatmap } from "../components/ClusterProfileHeatmap";
import { StrategyTable, type StrategyRow } from "../components/StrategyTable";
import { chartTooltipProps } from "../components/analytics/chartTheme";
import { clusterStrategyRows } from "../lib/decisionIntel";
import { isPercentStyleColumnId, scalePercentLikeValue } from "../lib/percentDisplay";

type Row = {
  cluster_id: number;
  store_count: number;
  top_category?: string;
  cluster_persona?: string;
};

type ClusterProduct = { sku: string; product: string; count: number };

const STORES_PAGE_SIZE = 80;

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export function ClusterPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ stores: string[]; topProducts: ClusterProduct[] } | null>(null);
  const [profileCols, setProfileCols] = useState<ClusterProfileColumn[]>([]);
  const [profileRows, setProfileRows] = useState<ClusterProfileRow[]>([]);
  const [topProductsByCluster, setTopProductsByCluster] = useState<Record<number, string[]>>({});
  const [storeQuery, setStoreQuery] = useState("");
  const [storePage, setStorePage] = useState(0);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storesChartExpanded, setStoresChartExpanded] = useState(false);

  const detailsRef = useRef<HTMLDivElement>(null);
  const skipScrollRef = useRef(true);

  useEffect(() => {
    fetchClusterBreakdown()
      .then((r) => setRows((r.clusters as Row[]) ?? []))
      .catch((e) => setListErr(e instanceof Error ? e.message : String(e)));
    fetchClusterProfile()
      .then((p) => {
        setProfileCols(p.columns ?? []);
        setProfileRows(p.rows ?? []);
      })
      .catch(() => {
        setProfileCols([]);
        setProfileRows([]);
      });
  }, []);

  const chartData = useMemo(
    () => rows.map((r) => ({ id: `C${r.cluster_id}`, stores: r.store_count, cid: r.cluster_id })),
    [rows],
  );

  const profileMetrics = useMemo(() => {
    if (selected == null) return null;
    const row = profileRows.find((r) => r.cluster_id === selected);
    if (!row?.values) return null;
    const v = row.values;
    const keys: [string, string][] = [
      ["NET_AMT_AVG_MONTHLY", "Avg monthly net spend"],
      ["AVG_INVOICE_PURCHASE", "Avg purchase per invoice"],
      ["INV_COUNT_AVG_MONTHLY", "Avg invoices per month"],
      ["AVG_NO_DAYS_BETWEEN_PURCHASE", "Avg days between purchases"],
      ["PURCHASE_FREQ_PER_DAY", "Purchase frequency"],
      ["UNIQUE_PRD_COUNT_PER_INV", "Products per invoice"],
    ];
    const out = keys
      .filter(([id]) => v[id] != null && Number.isFinite(Number(v[id])))
      .map(([id, label]) => ({
        label,
        value: formatClusterMetricValue(id, Number(v[id])),
      }));
    return out.length ? out : null;
  }, [selected, profileRows]);

  const categoryMix = useMemo(() => {
    if (selected == null) return null;
    const row = profileRows.find((r) => r.cluster_id === selected);
    if (!row?.values) return null;
    const ids = [
      ["Kids_SALES_PCT", "Kids"],
      ["Men_SALES_PCT", "Men"],
      ["Women_SALES_PCT", "Women"],
    ] as const;
    const items = ids
      .filter(([id]) => row.values[id] != null && Number.isFinite(Number(row.values[id])))
      .map(([id, label]) => ({
        label,
        value: formatMixValue(id, Number(row.values[id])),
      }));
    return items.length ? items : null;
  }, [selected, profileRows]);

  const priceTier = useMemo(() => {
    if (selected == null) return null;
    const row = profileRows.find((r) => r.cluster_id === selected);
    if (!row?.values) return null;
    const ids = [
      ["Entry_PCT", "Entry"],
      ["Mid_PCT", "Mid"],
      ["Premium_PCT", "Premium"],
      ["Luxury_PCT", "Luxury"],
    ] as const;
    const items = ids
      .filter(([id]) => row.values[id] != null && Number.isFinite(Number(row.values[id])))
      .map(([id, label]) => ({
        label,
        value: formatMixValue(id, Number(row.values[id])),
      }));
    return items.length ? items : null;
  }, [selected, profileRows]);

  const actionableIdeas = useMemo(() => {
    if (selected == null) return [];
    const meta = rows.find((r) => r.cluster_id === selected);
    const ideas: string[] = [];
    detail?.topProducts.slice(0, 3).forEach((p) => {
      ideas.push(`Push ${p.product} (${p.sku}) — appears in ${p.count} recommendation lines for this cluster.`);
    });
    if (meta?.top_category) {
      ideas.push(`Prioritize ${meta.top_category} assortment depth and promo facings in Cluster ${selected}.`);
    }
    if (!ideas.length && insight?.next_actions?.length) {
      return insight.next_actions.slice(0, 3);
    }
    return ideas;
  }, [detail, insight, rows, selected]);

  const strategyRows: StrategyRow[] = useMemo(
    () =>
      clusterStrategyRows(rows).map((r) => {
        const id = Number(r.clusterName.match(/Cluster (\d+)/)?.[1] ?? NaN);
        return {
          ...r,
          topProducts: Number.isFinite(id) ? topProductsByCluster[id] ?? [] : [],
        };
      }),
    [rows, topProductsByCluster],
  );

  const filteredStores = useMemo(() => {
    const stores = detail?.stores ?? [];
    const q = storeQuery.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => s.toLowerCase().includes(q));
  }, [detail?.stores, storeQuery]);

  const pagedStores = useMemo(() => {
    const start = storePage * STORES_PAGE_SIZE;
    return filteredStores.slice(start, start + STORES_PAGE_SIZE);
  }, [filteredStores, storePage]);

  const storePageCount = Math.max(1, Math.ceil(filteredStores.length / STORES_PAGE_SIZE));

  useEffect(() => {
    setStoreQuery("");
    setStorePage(0);
    setSelectedStore(null);
  }, [selected]);

  useEffect(() => {
    setStorePage(0);
  }, [storeQuery]);

  useEffect(() => {
    if (!storesChartExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStoresChartExpanded(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [storesChartExpanded]);

  useEffect(() => {
    if (!rows.length) return;
    Promise.all(
      rows.map(async (r) => {
        const d = await fetchClusterDetail(r.cluster_id);
        const top = (d.top_recommended_skus ?? []).slice(0, 3).map((x) => String(x.PRODUCT_NAME ?? x.SKU_CODE ?? "—"));
        return [r.cluster_id, top] as const;
      }),
    )
      .then((entries) => setTopProductsByCluster(Object.fromEntries(entries)))
      .catch(() => setTopProductsByCluster({}));
  }, [rows]);

  useEffect(() => {
    if (selected == null) {
      setInsight(null);
      setDetail(null);
      return;
    }
    setLoading(true);
    setErr(null);
    postInsightCluster(selected)
      .then((r) => setInsight(r.insight))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    fetchClusterDetail(selected)
      .then((d) =>
        setDetail({
          stores: d.stores ?? [],
          topProducts: (d.top_recommended_skus ?? []).slice(0, 12).map((x) => ({
            sku: String(x.SKU_CODE ?? ""),
            product: String(x.PRODUCT_NAME ?? "—"),
            count: Number(x.count ?? 0),
          })),
        }),
      )
      .catch(() => setDetail(null));
  }, [selected]);

  useEffect(() => {
    if (selected == null) return;
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [selected]);

  const selectCluster = (cid: number) => {
    skipScrollRef.current = false;
    setSelected(cid);
  };

  return (
    <div className="space-y-8">
      <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-50">Clusters &amp; Strategy</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Segment profiles, store counts, playbooks and AI summaries.
        </p>
      </motion.div>

      {listErr ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
          {listErr}
        </div>
      ) : null}

      {/* Cluster profile heatmap */}
      <motion.section
        {...fadeUp}
        transition={{ duration: 0.45, delay: 0.1 }}
        className="rounded-2xl border border-surface-border/80 bg-surface-card/70 p-5 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-8"
      >
        <h2 className="font-display text-lg font-semibold text-slate-100">Cluster profile</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
          Each column summarizes how stores in a cluster behave on average.{" "}
          <span className="text-slate-400">
            <span className="font-medium text-slate-300">Avg monthly net spend</span> is typical revenue per month;{" "}
            <span className="font-medium text-slate-300">avg invoice amount</span> is basket size per visit;{" "}
            <span className="font-medium text-slate-300">avg invoices per month</span> is how often customers shop;{" "}
            <span className="font-medium text-slate-300">avg days between purchases</span> captures visit cadence;{" "}
            <span className="font-medium text-slate-300">products per invoice</span> reflects basket breadth.{" "}
            <span className="font-medium text-slate-300">Category mix</span> shows Men / Women / Kids share of sales.
          </span>
        </p>
        <div className="mt-5">
          <ClusterProfileHeatmap
            columns={profileCols}
            rows={profileRows}
            selectedClusterId={selected}
            onSelectCluster={selectCluster}
          />
        </div>
      </motion.section>

      {/* Charts — resizable split + expand */}
      <motion.section {...fadeUp} transition={{ duration: 0.45, delay: 0.15 }} className="min-h-[340px]">
        <Group orientation="horizontal" className="flex min-h-[340px] w-full" id="clusters-chart-split">
          <Panel defaultSize="58" minSize="32" className="min-w-0" id="stores-chart">
            <div className="mr-1.5 flex h-full flex-col rounded-2xl border border-surface-border/80 bg-surface-card/70 p-5 shadow-lg shadow-black/15 backdrop-blur-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200">Stores per Cluster</h2>
                  <p className="mt-1 text-[11px] text-slate-600">Click a bar to select that cluster for drill-down.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStoresChartExpanded(true)}
                  className="rounded-lg border border-surface-border/80 bg-surface-raised/40 p-1.5 text-slate-500 transition hover:bg-surface-raised hover:text-slate-300"
                  title="Expand"
                  aria-label="Expand stores per cluster chart"
                >
                  <Expand className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-4 min-h-[260px] flex-1">
                <StoresPerClusterChart
                  chartData={chartData}
                  selected={selected}
                  onSelect={selectCluster}
                  height={260}
                />
              </div>
            </div>
          </Panel>

          <Separator className="group relative flex w-3 shrink-0 items-center justify-center outline-none">
            <div className="h-12 w-1 rounded-full bg-surface-border transition group-hover:bg-accent/60 group-active:bg-accent group-data-[active]:bg-accent" />
          </Separator>

          <Panel defaultSize="42" minSize="24" className="min-w-0" id="clusters-list">
            <div className="ml-1.5 flex h-full flex-col rounded-2xl border border-surface-border/80 bg-surface-card/70 p-5 shadow-lg shadow-black/15 backdrop-blur-sm sm:p-6">
              <h2 className="text-sm font-semibold text-slate-200">Clusters</h2>
              <p className="mt-1 text-[11px] text-slate-600">Click a row to select that cluster for drill-down.</p>
              <ul className="mt-4 flex min-h-[260px] flex-1 flex-col gap-2 overflow-y-auto">
                {rows.length ? (
                  rows.map((r) => {
                    const active = selected === r.cluster_id;
                    return (
                      <li key={r.cluster_id}>
                        <button
                          type="button"
                          onClick={() => selectCluster(r.cluster_id)}
                          className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition duration-200 ${
                            active
                              ? "border-accent/40 bg-accent/15 text-slate-100"
                              : "border-surface-border/70 bg-surface-raised/30 text-slate-300 hover:border-accent/25 hover:bg-surface-raised/60"
                          }`}
                        >
                          <span className="font-medium">
                            Cluster {r.cluster_id} ({r.store_count.toLocaleString()} stores)
                          </span>
                        </button>
                      </li>
                    );
                  })
                ) : (
                  <li className="flex flex-1 items-center justify-center text-sm text-slate-500">No cluster data</li>
                )}
              </ul>
            </div>
          </Panel>
        </Group>
      </motion.section>

      {storesChartExpanded && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex flex-col bg-surface/95 backdrop-blur-md"
              role="dialog"
              aria-modal="true"
              aria-label="Stores per cluster fullscreen"
            >
              <div className="flex items-center justify-between gap-4 border-b border-surface-border/80 px-5 py-4 sm:px-8">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-100">Stores per Cluster</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Fullscreen view · press Esc to close</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStoresChartExpanded(false)}
                    className="rounded-lg border border-surface-border/80 bg-accent/20 p-1.5 text-accent"
                    title="Exit fullscreen"
                    aria-label="Exit fullscreen"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStoresChartExpanded(false)}
                    className="rounded-xl border border-surface-border bg-surface-raised/60 p-2 text-slate-400 transition hover:bg-surface-raised hover:text-slate-200"
                    title="Close"
                    aria-label="Close fullscreen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 p-5 sm:p-8">
                <div className="h-[min(70vh,720px)] rounded-2xl border border-surface-border/80 bg-surface-card/70 p-6">
                  <StoresPerClusterChart
                    chartData={chartData}
                    selected={selected}
                    onSelect={selectCluster}
                    height="100%"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Drill-down sections */}
      <AnimatePresence mode="wait">
        {selected != null ? (
          <motion.div
            key={selected}
            ref={detailsRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35 }}
            className="space-y-8 scroll-mt-24"
          >
            {/* Section 1 — Stores */}
            <section className="rounded-2xl border border-surface-border/80 bg-surface-card/70 p-5 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-slate-100">
                    Stores in Cluster {selected}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {(detail?.stores?.length ?? 0).toLocaleString()} stores
                    {storeQuery.trim()
                      ? ` · ${filteredStores.length.toLocaleString()} match “${storeQuery.trim()}”`
                      : ""}
                  </p>
                </div>
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="search"
                    value={storeQuery}
                    onChange={(e) => setStoreQuery(e.target.value)}
                    placeholder="Search store ID…"
                    className="w-full rounded-xl border border-surface-border bg-surface px-9 py-2 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
                  />
                </div>
              </div>

              {pagedStores.length ? (
                <>
                  <ul className="mt-5 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
                    {pagedStores.map((s, i) => {
                      const active = selectedStore === s;
                      return (
                        <motion.li
                          key={s}
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: Math.min(i * 0.01, 0.3), duration: 0.2 }}
                        >
                          <Link
                            to={`/recommendations?store=${encodeURIComponent(s)}`}
                            onClick={() => setSelectedStore(s)}
                            className={`inline-flex rounded-lg border px-2.5 py-1.5 text-xs font-medium transition duration-150 ${
                              active
                                ? "border-accent bg-accent/20 text-accent ring-1 ring-accent/40"
                                : "border-accent/30 bg-surface text-accent hover:border-accent/60 hover:bg-accent/10"
                            }`}
                            title="Open recommendations (future expansion placeholder)"
                          >
                            {s}
                          </Link>
                        </motion.li>
                      );
                    })}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-600">
                      Showing {storePage * STORES_PAGE_SIZE + 1}–
                      {Math.min((storePage + 1) * STORES_PAGE_SIZE, filteredStores.length)} of{" "}
                      {filteredStores.length.toLocaleString()}
                      {filteredStores.length < (detail?.stores.length ?? 0)
                        ? ` (filtered from ${(detail?.stores.length ?? 0).toLocaleString()})`
                        : ""}
                    </p>
                    {storePageCount > 1 ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={storePage <= 0}
                          onClick={() => setStorePage((p) => Math.max(0, p - 1))}
                          className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-slate-300 transition enabled:hover:bg-surface-raised disabled:opacity-40"
                        >
                          Previous
                        </button>
                        <span className="text-xs text-slate-500">
                          {storePage + 1} / {storePageCount}
                        </span>
                        <button
                          type="button"
                          disabled={storePage >= storePageCount - 1}
                          onClick={() => setStorePage((p) => Math.min(storePageCount - 1, p + 1))}
                          className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-slate-300 transition enabled:hover:bg-surface-raised disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="mt-5 text-sm text-slate-500">
                  {loading ? "Loading stores…" : storeQuery.trim() ? "No stores match your search." : "No stores in this cluster."}
                </p>
              )}
            </section>

            {/* Section 2 — Cluster details */}
            <ClusterExplanationCard
              clusterLabel={`Cluster ${selected}`}
              meta={rows.find((r) => r.cluster_id === selected)}
              profileMetrics={profileMetrics}
              categoryMix={categoryMix}
              priceTier={priceTier}
              insight={insight}
              engagementIdeas={actionableIdeas}
              loading={loading}
              error={err}
            />

            {/* Section 3 — Strategy */}
            <StrategyTable rows={strategyRows} selectedClusterId={selected} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-dashed border-surface-border/80 bg-surface-card/40 px-6 py-10 text-center"
          >
            <p className="text-sm text-slate-500">
              Select a cluster from the heatmap, chart, or list to view stores, details, and strategy.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always-visible strategy when nothing selected — preserve prior always-on playbook */}
      {selected == null && strategyRows.length ? (
        <StrategyTable rows={strategyRows} selectedClusterId={null} />
      ) : null}
    </div>
  );
}

type ChartDatum = { id: string; stores: number; cid: number };

function StoresPerClusterChart({
  chartData,
  selected,
  onSelect,
  height,
}: {
  chartData: ChartDatum[];
  selected: number | null;
  onSelect: (cid: number) => void;
  height: number | string;
}) {
  if (!chartData.length) {
    return (
      <p className="flex h-full min-h-[260px] items-center justify-center text-sm text-slate-500">
        No cluster data
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" />
        <XAxis dataKey="id" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={11} />
        <Tooltip {...chartTooltipProps} />
        <Bar
          dataKey="stores"
          radius={[6, 6, 0, 0]}
          cursor="pointer"
          onClick={(d: { payload?: { cid?: number } }) => {
            const cid = d?.payload?.cid;
            if (typeof cid === "number") onSelect(cid);
          }}
        >
          {chartData.map((d) => (
            <Cell key={d.cid} fill={selected === d.cid ? "#60a5fa" : "#a78bfa"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatMixValue(id: string, n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (isPercentStyleColumnId(id)) return `${scalePercentLikeValue(n).toFixed(1)}`;
  return String(n);
}

function formatClusterMetricValue(id: string, n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  switch (id) {
    case "NET_AMT_AVG_MONTHLY":
    case "AVG_INVOICE_PURCHASE":
      if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
      if (a >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
      return n.toFixed(2);
    case "INV_COUNT_AVG_MONTHLY":
    case "UNIQUE_PRD_COUNT_PER_INV":
      return n.toFixed(2);
    case "AVG_NO_DAYS_BETWEEN_PURCHASE":
      return n.toFixed(1);
    case "PURCHASE_FREQ_PER_DAY":
      return n.toFixed(4);
    default:
      return String(n);
  }
}
