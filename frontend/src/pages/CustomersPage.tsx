import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, Filter, Search, Users } from "lucide-react";
import {
  fetchB2CCustomers,
  fetchB2CSegments,
  type B2CCustomerListItem,
  type B2CSegmentSummary,
} from "../api";

const PAGE_SIZE = 25;
type SortKey = "buy_count" | "pv_count" | "total_events" | "recency_days" | "user_id";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "buy_count", label: "Buys" },
  { value: "pv_count", label: "Views" },
  { value: "total_events", label: "Total events" },
  { value: "recency_days", label: "Recency" },
  { value: "user_id", label: "User ID" },
];

export function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const segmentParam = searchParams.get("segment");

  const [segments, setSegments] = useState<B2CSegmentSummary[]>([]);
  const [customers, setCustomers] = useState<B2CCustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [segmentFilter, setSegmentFilter] = useState<number | null>(
    segmentParam != null && segmentParam !== "" && Number.isFinite(Number(segmentParam))
      ? Number(segmentParam)
      : null,
  );
  const [minBuys, setMinBuys] = useState<number>(0);
  const [sort, setSort] = useState<SortKey>("buy_count");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [userIdQuery, setUserIdQuery] = useState("");

  // Load segment list once for filter chips.
  useEffect(() => {
    fetchB2CSegments()
      .then((r) => setSegments(r.segments))
      .catch(() => setSegments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchB2CCustomers({
        limit: PAGE_SIZE,
        offset,
        segment: segmentFilter ?? undefined,
        minBuys: minBuys || undefined,
        sort,
        order,
      });
      setCustomers(r.customers);
      setTotal(r.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [offset, segmentFilter, minBuys, sort, order]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep offset at 0 when filters change
  useEffect(() => {
    setOffset(0);
  }, [segmentFilter, minBuys, sort, order]);

  // Sync segment filter into URL for shareable links
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (segmentFilter != null) params.set("segment", String(segmentFilter));
    else params.delete("segment");
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentFilter]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filteredCustomers = useMemo(() => {
    if (!userIdQuery.trim()) return customers;
    const q = userIdQuery.trim();
    return customers.filter((c) => String(c.user_id).includes(q));
  }, [customers, userIdQuery]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Customers (B2C)
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-100">
          Customer directory
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Search customers, filter by segment, and drill into a 360° profile with
          personalised recommendations.
        </p>
      </header>

      {/* Filter bar */}
      <section className="rounded-xl border border-surface-border bg-surface-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-2 py-1.5">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={userIdQuery}
              onChange={(e) => setUserIdQuery(e.target.value)}
              placeholder="Filter by user ID…"
              className="w-40 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Segment
            </span>
            <button
              type="button"
              onClick={() => setSegmentFilter(null)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                segmentFilter == null
                  ? "border-accent bg-accent/20 text-slate-100"
                  : "border-surface-border bg-surface-raised text-slate-400 hover:text-slate-200"
              }`}
            >
              All
            </button>
            {segments.map((s) => (
              <button
                type="button"
                key={s.cluster_id}
                onClick={() => setSegmentFilter(s.cluster_id)}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                  segmentFilter === s.cluster_id
                    ? "border-accent bg-accent/20 text-slate-100"
                    : "border-surface-border bg-surface-raised text-slate-400 hover:text-slate-200"
                }`}
                title={`${s.user_count.toLocaleString()} users`}
              >
                {s.cluster_persona}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-2 py-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            <label className="text-[11px] text-slate-500">Min buys</label>
            <input
              type="number"
              min={0}
              value={minBuys}
              onChange={(e) => setMinBuys(Math.max(0, Number(e.target.value || 0)))}
              className="w-14 bg-transparent text-sm text-slate-100 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-2 py-1.5">
            <label className="text-[11px] text-slate-500">Sort</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-transparent text-sm text-slate-100 focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-surface-card">
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
              className="rounded-md border border-surface-border px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-surface-card"
              title="Toggle sort direction"
            >
              {order.toUpperCase()}
            </button>
          </div>
        </div>
      </section>

      {err ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {err}
        </div>
      ) : null}

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-surface-border bg-surface-card">
        <div className="flex items-center justify-between border-b border-surface-border/70 px-4 py-2">
          <div className="flex items-center gap-2 text-slate-400">
            <Users className="h-4 w-4" />
            <p className="text-sm">
              <span className="font-mono text-slate-200">{total.toLocaleString()}</span>{" "}
              customer{total === 1 ? "" : "s"}
              {segmentFilter != null
                ? ` in ${segments.find((s) => s.cluster_id === segmentFilter)?.cluster_persona ?? `cluster ${segmentFilter}`}`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-border text-slate-400 transition hover:bg-surface-raised disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setOffset(Math.min((pageCount - 1) * PAGE_SIZE, offset + PAGE_SIZE))}
              disabled={page >= pageCount || loading}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-surface-border text-slate-400 transition hover:bg-surface-raised disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-surface-border/70 bg-surface-raised/50 text-left text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 font-medium">User ID</th>
                <th className="px-4 py-2 font-medium">Segment</th>
                <th className="px-4 py-2 text-right font-medium">Views</th>
                <th className="px-4 py-2 text-right font-medium">Buys</th>
                <th className="px-4 py-2 text-right font-medium">Total events</th>
                <th className="px-4 py-2 text-right font-medium">Recency (d)</th>
                <th className="px-4 py-2 text-right font-medium">Top category</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[13px] text-slate-500">
                    No customers match your filters.
                  </td>
                </tr>
              ) : null}
              {filteredCustomers.map((c) => (
                <tr key={c.user_id} className="border-t border-surface-border/40 transition hover:bg-surface-raised/40">
                  <td className="px-4 py-2 font-mono text-slate-100">{c.user_id}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-md border border-surface-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      {c.cluster_persona}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {c.pv_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-100">
                    {c.buy_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {c.total_events.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {c.recency_days.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-400">
                    {c.top_category > 0 ? c.top_category : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      to={`/customers/${c.user_id}`}
                      className="group inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                    >
                      View
                      <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
