import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { UsersRound, ArrowRight, Trophy, Ban, ShoppingCart, Eye, Sparkles } from "lucide-react";
import {
  fetchB2CSegments,
  fetchB2CSegmentDetail,
  type B2CSegmentDetail,
  type B2CSegmentSummary,
} from "../api";
import { PIE_COLORS, chartTooltipProps, formatCompactNumber } from "../components/analytics/chartTheme";

/** Match personas to friendly icons so a busy grid is scannable. */
function personaIcon(persona: string) {
  const p = persona.toLowerCase();
  if (p.includes("frequent")) return Trophy;
  if (p.includes("cart")) return ShoppingCart;
  if (p.includes("big-basket")) return Sparkles;
  if (p.includes("passive") || p.includes("browser")) return Eye;
  if (p.includes("one-time") || p.includes("new")) return Ban;
  return UsersRound;
}

function personaTone(persona: string): { border: string; badge: string; iconBg: string } {
  const p = persona.toLowerCase();
  if (p.includes("frequent")) {
    return {
      border: "border-emerald-500/40",
      badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      iconBg: "bg-emerald-500/15 text-emerald-300",
    };
  }
  if (p.includes("cart")) {
    return {
      border: "border-amber-500/40",
      badge: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      iconBg: "bg-amber-500/15 text-amber-300",
    };
  }
  if (p.includes("big-basket")) {
    return {
      border: "border-fuchsia-500/40",
      badge: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
      iconBg: "bg-fuchsia-500/15 text-fuchsia-300",
    };
  }
  if (p.includes("passive") || p.includes("browser")) {
    return {
      border: "border-sky-500/40",
      badge: "bg-sky-500/10 text-sky-300 border-sky-500/30",
      iconBg: "bg-sky-500/15 text-sky-300",
    };
  }
  return {
    border: "border-slate-500/40",
    badge: "bg-slate-500/10 text-slate-300 border-slate-500/30",
    iconBg: "bg-slate-500/15 text-slate-300",
  };
}

function pct(v: number, digits = 1) {
  return `${(v * 100).toFixed(digits)}%`;
}
function num(v: number) {
  return Math.round(v).toLocaleString();
}

export function CustomerSegmentsPage() {
  const [segments, setSegments] = useState<B2CSegmentSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<B2CSegmentDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchB2CSegments()
      .then((r) => {
        if (cancelled) return;
        setSegments(r.segments);
        if (r.segments.length && selected == null) {
          setSelected(r.segments[0].cluster_id);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchB2CSegmentDetail(selected, 50)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const chartData = useMemo(
    () =>
      segments.map((s, i) => ({
        name: `C${s.cluster_id}`,
        persona: s.cluster_persona,
        users: s.user_count,
        color: PIE_COLORS[i % PIE_COLORS.length],
      })),
    [segments],
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Customers (B2C)
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-100">
          Segments
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          KMeans grouping of {segments.reduce((s, x) => s + x.user_count, 0).toLocaleString() || "…"} customers on
          RFM + behavior features. Personas are auto-assigned from cluster centroids.
        </p>
      </header>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {/* Distribution chart */}
      {chartData.length ? (
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Segment size distribution</h2>
            <span className="text-[11px] text-slate-500">Click a bar to drill in</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} />
                <YAxis
                  stroke="#94a3b8"
                  tickLine={false}
                  width={52}
                  tickFormatter={formatCompactNumber}
                />
                <Tooltip
                  {...chartTooltipProps}
                  formatter={(v: number) => v.toLocaleString()}
                  labelFormatter={(_l, payload) => {
                    const p = payload?.[0]?.payload as { persona?: string } | undefined;
                    return p?.persona ?? "";
                  }}
                />
                <Bar
                  dataKey="users"
                  radius={[6, 6, 0, 0]}
                  onClick={(e: { payload?: { name?: string } }) => {
                    const name = e?.payload?.name;
                    if (typeof name === "string") {
                      const cid = Number(name.replace("C", ""));
                      if (Number.isFinite(cid)) setSelected(cid);
                    }
                  }}
                  cursor="pointer"
                >
                  {chartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.color}
                      stroke={selected != null && entry.name === `C${selected}` ? "#f8fafc" : "transparent"}
                      strokeWidth={selected != null && entry.name === `C${selected}` ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {/* Segment cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {segments.map((s) => {
          const Icon = personaIcon(s.cluster_persona);
          const tone = personaTone(s.cluster_persona);
          const isActive = selected === s.cluster_id;
          return (
            <button
              type="button"
              key={s.cluster_id}
              onClick={() => setSelected(s.cluster_id)}
              className={`group flex flex-col justify-between rounded-xl border ${
                isActive ? tone.border : "border-surface-border"
              } bg-surface-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-slate-500 hover:bg-surface-raised`}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Cluster {s.cluster_id}
                  </p>
                  <p className="mt-0.5 truncate font-display text-sm font-semibold text-slate-100">
                    {s.cluster_persona}
                  </p>
                </div>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
              </div>
              <div className="mt-3">
                <p className="font-mono text-lg font-semibold text-slate-100">
                  {num(s.user_count)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {pct(s.share)} of customers
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <dt className="text-slate-500">Avg buys</dt>
                  <dd className="font-mono text-slate-200">{s.avg_buy_count.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Avg views</dt>
                  <dd className="font-mono text-slate-200">{s.avg_pv_count.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Buy share</dt>
                  <dd className="font-mono text-slate-200">{pct(s.avg_buy_share)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Recency</dt>
                  <dd className="font-mono text-slate-200">{s.avg_recency_days.toFixed(2)}d</dd>
                </div>
              </dl>
            </button>
          );
        })}
      </section>

      {/* Segment detail */}
      {selected != null ? (
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Segment Detail
              </p>
              <h2 className="mt-0.5 truncate font-display text-lg font-semibold text-slate-100">
                {detail?.cluster_persona ?? `Cluster ${selected}`}
              </h2>
            </div>
            {detailLoading ? (
              <span className="text-[11px] text-slate-500">Loading…</span>
            ) : null}
          </div>

          {detail?.found ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Left: profile stats */}
              <div className="rounded-lg border border-surface-border bg-surface-raised/50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Average behavior
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                  {Object.entries(detail.profile).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-surface-border/50 py-1">
                      <span className="text-slate-500">{k.replaceAll("_", " ")}</span>
                      <span className="font-mono text-slate-200">
                        {typeof v === "number"
                          ? v < 1 && v > 0
                            ? v.toFixed(3)
                            : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: top items + sample users */}
              <div className="space-y-4">
                <div className="rounded-lg border border-surface-border bg-surface-raised/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    Top recommended items in this segment
                  </p>
                  {detail.top_items.length ? (
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="py-1 text-left font-medium">Item ID</th>
                          <th className="py-1 text-right font-medium">Users</th>
                          <th className="py-1 text-right font-medium">Avg score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.top_items.slice(0, 10).map((it) => (
                          <tr key={it.item_id} className="border-t border-surface-border/50">
                            <td className="py-1.5 font-mono text-slate-300">{it.item_id}</td>
                            <td className="py-1.5 text-right font-mono text-slate-200">
                              {num(it.users)}
                            </td>
                            <td className="py-1.5 text-right font-mono text-slate-200">
                              {it.avg_score.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-[12px] text-slate-500">No items yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-surface-border bg-surface-raised/50 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    Sample users
                  </p>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {detail.sample_users.slice(0, 30).map((uid) => (
                      <Link
                        key={uid}
                        to={`/customers/${uid}`}
                        className="group inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-card px-2 py-0.5 font-mono text-[11px] text-slate-300 transition hover:border-slate-500 hover:bg-surface-raised hover:text-slate-100"
                      >
                        {uid}
                        <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                      </Link>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Link
                      to={`/customers?segment=${selected}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      See all {num(detail.user_count)} customers in this segment
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : detail?.found === false ? (
            <p className="text-[13px] text-slate-500">Segment not found.</p>
          ) : (
            <p className="text-[13px] text-slate-500">Loading segment detail…</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
