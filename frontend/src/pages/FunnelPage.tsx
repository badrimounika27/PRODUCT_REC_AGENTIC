import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Filter } from "lucide-react";
import { fetchB2CFunnel, type B2CFunnelResponse } from "../api";
import { Kpi } from "../components/Kpi";
import {
  PIE_COLORS,
  SERIES_LINE_COLORS,
  chartTooltipProps,
  formatCompactNumber,
} from "../components/analytics/chartTheme";

function num(v: number) {
  return v.toLocaleString();
}
function pct(v: number, digits = 2) {
  return `${(v * 100).toFixed(digits)}%`;
}

export function FunnelPage() {
  const [data, setData] = useState<B2CFunnelResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchB2CFunnel(20)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overall = data?.overall ?? {};
  const funnelSteps = useMemo(
    () => [
      { step: "View",         key: "pv_count",   count: Number(overall.pv_count   ?? 0) },
      { step: "Add to cart",  key: "cart_count", count: Number(overall.cart_count ?? 0) },
      { step: "Favourite",    key: "fav_count",  count: Number(overall.fav_count  ?? 0) },
      { step: "Buy",          key: "buy_count",  count: Number(overall.buy_count  ?? 0) },
    ],
    [overall],
  );

  const byDate = data?.by_date ?? [];
  const dateChartData = useMemo(
    () =>
      byDate.map((row) => ({
        date: String(row.event_date),
        pv: Number(row.pv_count ?? 0),
        cart: Number(row.cart_count ?? 0),
        fav: Number(row.fav_count ?? 0),
        buy: Number(row.buy_count ?? 0),
      })),
    [byDate],
  );

  const topCats = data?.top_categories ?? [];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Customers (B2C)
        </p>
        <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-slate-100">
          <Filter className="h-6 w-6 text-slate-400" />
          Shopping funnel
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          How customers move from viewing to buying — broken down by day and by category.
        </p>
      </header>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {/* KPI strip */}
      {data ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Total events"
            value={num(funnelSteps.reduce((s, r) => s + r.count, 0))}
            sub={`${num(Number(overall.unique_users ?? 0))} unique users`}
            tone="indigo"
          />
          <Kpi
            label="View → buy"
            value={pct(Number(overall.pv_to_buy_rate ?? 0))}
            sub={`${num(funnelSteps[0].count)} views`}
            tone="sky"
          />
          <Kpi
            label="Cart → buy"
            value={pct(Number(overall.cart_to_buy_rate ?? 0))}
            sub={`${num(funnelSteps[1].count)} carts`}
            tone="amber"
          />
          <Kpi
            label="Categories"
            value={num(Number(overall.unique_categories ?? 0))}
            sub={`${num(Number(overall.unique_items ?? 0))} items`}
            tone="emerald"
          />
        </section>
      ) : null}

      {/* Funnel */}
      {data ? (
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Overall funnel
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelSteps} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
                  {funnelSteps.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {/* Daily trend */}
      {dateChartData.length ? (
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Daily activity
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dateChartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#94a3b8" tickLine={false} minTickGap={20} />
                <YAxis
                  stroke="#94a3b8"
                  tickLine={false}
                  width={52}
                  tickFormatter={formatCompactNumber}
                />
                <Tooltip {...chartTooltipProps} formatter={(v: number) => v.toLocaleString()} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
                <Line type="monotone" dataKey="pv"   name="View"        stroke={SERIES_LINE_COLORS[0]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cart" name="Cart"        stroke={SERIES_LINE_COLORS[2]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="fav"  name="Favourite"   stroke={SERIES_LINE_COLORS[3]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="buy"  name="Buy"         stroke={SERIES_LINE_COLORS[7]} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {/* Top categories */}
      {topCats.length ? (
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Top categories by view-through
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-surface-border/70 text-left text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="py-1.5 font-medium">Category ID</th>
                  <th className="py-1.5 text-right font-medium">Views</th>
                  <th className="py-1.5 text-right font-medium">Cart</th>
                  <th className="py-1.5 text-right font-medium">Buys</th>
                  <th className="py-1.5 text-right font-medium">View → buy</th>
                  <th className="py-1.5 text-right font-medium">Cart → buy</th>
                </tr>
              </thead>
              <tbody>
                {topCats.map((c, i) => (
                  <tr key={i} className="border-t border-surface-border/40">
                    <td className="py-1.5 font-mono text-slate-100">
                      {String(c.category_id)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-300">
                      {num(Number(c.pv_count))}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-300">
                      {num(Number(c.cart_count))}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-100">
                      {num(Number(c.buy_count))}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-300">
                      {pct(Number(c.pv_to_buy_rate ?? 0))}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-300">
                      {pct(Number(c.cart_to_buy_rate ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
