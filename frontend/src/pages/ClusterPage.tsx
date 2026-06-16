import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
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
import { clusterStrategyRows } from "../lib/decisionIntel";

type Row = {
  cluster_id: number;
  store_count: number;
  top_category?: string;
  cluster_persona?: string;
};

type ClusterProduct = { sku: string; product: string; count: number };

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
    ];
    const out = keys
      .filter(([id]) => v[id] != null && Number.isFinite(Number(v[id])))
      .map(([id, label]) => ({
        label,
        value: formatClusterMetricValue(id, Number(v[id])),
      }));
    return out.length ? out : null;
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Clusters &amp; strategy</h1>
        <p className="mt-1 text-slate-400">
          Segment profiles, store counts, and playbooks — select a cluster to drill down and read the AI summary.
        </p>
      </div>

      {listErr ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
          {listErr}
        </div>
      ) : null}

      {/* 1. Cluster profile heatmap */}
      <section className="rounded-2xl border border-surface-border bg-surface-card p-5">
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
        <div className="mt-4">
          <ClusterProfileHeatmap columns={profileCols} rows={profileRows} />
        </div>
      </section>

      {/* 2. Stores per cluster chart */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-slate-300">Stores per cluster</h2>
        <p className="text-[11px] text-slate-600">Click a bar to select that cluster for drill-down.</p>
        <div className="mt-4 h-72">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3344" />
                <XAxis dataKey="id" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    background: "#12171f",
                    border: "1px solid #2a3344",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                  itemStyle={{ color: "#cbd5e1" }}
                />
                <Bar
                  dataKey="stores"
                  fill="#a78bfa"
                  radius={[6, 6, 0, 0]}
                  cursor="pointer"
                  onClick={(d: { payload?: { cid?: number } }) => {
                    const cid = d?.payload?.cid;
                    if (typeof cid === "number") setSelected(cid);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-slate-500">No cluster data</p>
          )}
        </div>
      </div>

      {/* 3. Cluster selection + stores + explanation */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs font-semibold uppercase text-slate-500">Cluster</label>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 block rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {rows.map((r) => (
              <option key={r.cluster_id} value={r.cluster_id}>
                Cluster {r.cluster_id} ({r.store_count} stores)
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected != null && detail?.stores?.length ? (
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6">
          <h3 className="font-display font-semibold text-slate-200">Stores in cluster {selected}</h3>
          <ul className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
            {detail.stores.slice(0, 80).map((s) => (
              <li key={s}>
                <Link
                  to={`/recommendations?store=${encodeURIComponent(s)}`}
                  className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs text-accent hover:bg-accent/10"
                >
                  {s}
                </Link>
              </li>
            ))}
          </ul>
          {detail.stores.length > 80 ? (
            <p className="mt-2 text-xs text-slate-600">Showing first 80 stores.</p>
          ) : null}
        </div>
      ) : null}

      <ClusterExplanationCard
        clusterLabel={selected != null ? `Cluster ${selected}` : "Cluster"}
        meta={rows.find((r) => r.cluster_id === selected)}
        profileMetrics={profileMetrics}
        insight={insight}
        engagementIdeas={actionableIdeas}
        loading={loading}
        error={err}
      />

      {/* 4. Strategy table */}
      <StrategyTable rows={strategyRows} />
    </div>
  );
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
      return n.toFixed(2);
    case "AVG_NO_DAYS_BETWEEN_PURCHASE":
      return n.toFixed(1);
    default:
      return String(n);
  }
}
