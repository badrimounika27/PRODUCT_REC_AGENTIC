import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { ArrowLeft, Layers, Sparkles, UserRound } from "lucide-react";
import { fetchB2CCustomer, type B2CCustomerDetail } from "../api";
import { PIE_COLORS, chartTooltipProps, formatCompactNumber } from "../components/analytics/chartTheme";

function num(v: number) {
  return v.toLocaleString();
}
function pct(v: number) {
  return `${(v * 100).toFixed(2)}%`;
}

const FEATURE_LABELS: Record<string, string> = {
  pv_count: "Page views",
  cart_count: "Cart adds",
  fav_count: "Favourites",
  buy_count: "Purchases",
  total_events: "Total events",
  distinct_items: "Distinct items",
  distinct_categories: "Distinct categories",
  active_days: "Active days",
  recency_days: "Days since last event",
  top_category: "Top category ID",
  top_category_share: "Top-cat share",
  pv_to_buy_rate: "View → buy rate",
  cart_to_buy_rate: "Cart → buy rate",
  buy_share: "Buy share (of events)",
};

const FUNNEL_ORDER = ["pv_count", "cart_count", "fav_count", "buy_count"] as const;
const FUNNEL_LABEL: Record<typeof FUNNEL_ORDER[number], string> = {
  pv_count: "View",
  cart_count: "Add to cart",
  fav_count: "Favourite",
  buy_count: "Buy",
};

export function CustomerDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<B2CCustomerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchB2CCustomer(Number(userId))
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const funnelChartData = data?.found
    ? FUNNEL_ORDER.map((k, i) => ({
        step: FUNNEL_LABEL[k],
        count: Number(data.features?.[k] ?? 0),
        color: PIE_COLORS[i % PIE_COLORS.length],
      }))
    : [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-100"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Customer (B2C)
          </p>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-slate-100">
            <UserRound className="h-6 w-6 text-slate-400" />
            <span className="font-mono">#{userId}</span>
            {data?.found && data.cluster_persona ? (
              <span className="rounded-md border border-surface-border bg-surface-card px-2 py-0.5 text-[12px] font-medium text-slate-300">
                {data.cluster_persona}
              </span>
            ) : null}
          </h1>
        </div>
        {data?.found && data.cluster_id != null ? (
          <Link
            to={`/customers/segments`}
            className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
          >
            <Layers className="h-3.5 w-3.5" />
            View cluster {data.cluster_id}
          </Link>
        ) : null}
      </header>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : null}

      {data && !data.found ? (
        <div className="rounded-xl border border-surface-border bg-surface-card p-6 text-center">
          <p className="text-sm text-slate-300">
            No profile found for user{" "}
            <span className="font-mono">#{userId}</span>.
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            The user may not be in the current sample. Try picking one from the customer list.
          </p>
          <Link
            to="/customers"
            className="mt-3 inline-block rounded-md border border-surface-border bg-surface-raised px-3 py-1 text-[12px] text-slate-200 hover:border-slate-500"
          >
            Go to customer list
          </Link>
        </div>
      ) : null}

      {data?.found ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Funnel chart */}
          <section className="rounded-xl border border-surface-border bg-surface-card p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Personal funnel
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelChartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="step" stroke="#94a3b8" tickLine={false} />
                  <YAxis
                    stroke="#94a3b8"
                    tickLine={false}
                    width={52}
                    tickFormatter={formatCompactNumber}
                  />
                  <Tooltip {...chartTooltipProps} formatter={(v: number) => v.toLocaleString()} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {funnelChartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-slate-400">
              <div>
                View → buy:{" "}
                <span className="font-mono text-slate-200">
                  {pct(Number(data.features.pv_to_buy_rate ?? 0))}
                </span>
              </div>
              <div>
                Cart → buy:{" "}
                <span className="font-mono text-slate-200">
                  {pct(Number(data.features.cart_to_buy_rate ?? 0))}
                </span>
              </div>
            </div>
          </section>

          {/* Feature grid */}
          <section className="rounded-xl border border-surface-border bg-surface-card p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Behavior features
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              {Object.entries(data.features).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between border-b border-surface-border/50 py-1"
                >
                  <span className="text-slate-500">{FEATURE_LABELS[k] ?? k.replaceAll("_", " ")}</span>
                  <span className="font-mono text-slate-200">
                    {typeof v === "number"
                      ? v > 0 && v < 1
                        ? v.toFixed(4)
                        : num(Math.round(v * 100) / 100)
                      : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Recommendations */}
          <section className="rounded-xl border border-surface-border bg-surface-card p-4 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Recommended for this customer
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Sparkles className="h-3 w-3" />
                Top {data.top_recommendations.length}
              </span>
            </div>

            {data.top_recommendations.length === 0 ? (
              <p className="text-[13px] text-slate-500">No recommendations produced.</p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-surface-border/70 text-left text-[11px] uppercase tracking-widest text-slate-500">
                    <th className="py-1.5 font-medium">Rank</th>
                    <th className="py-1.5 font-medium">Item ID</th>
                    <th className="py-1.5 text-right font-medium">Score</th>
                    <th className="py-1.5 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_recommendations.map((r) => (
                    <tr key={r.rank} className="border-t border-surface-border/40">
                      <td className="py-1.5 font-mono text-slate-400">{r.rank}</td>
                      <td className="py-1.5 font-mono text-slate-100">{r.item_id}</td>
                      <td className="py-1.5 text-right font-mono text-slate-200">
                        {r.score.toFixed(4)}
                      </td>
                      <td className="py-1.5">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                            r.reason === "bundle_lift"
                              ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300"
                              : "border-sky-500/40 bg-sky-500/10 text-sky-300"
                          }`}
                        >
                          {r.reason.replaceAll("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
