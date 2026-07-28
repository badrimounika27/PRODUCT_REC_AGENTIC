import { useEffect } from "react";
import { Download, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { isPercentStyleColumnId, scalePercentLikeValue } from "../lib/percentDisplay";

export type StoreColumn = { id: string; label: string };
export type StoreRow = Record<string, string | number | null>;

export const CLUSTER_STORES_PAGE_SIZE = 20;

type Props = {
  clusterId: number;
  columns: StoreColumn[];
  rows: StoreRow[];
  storeQuery: string;
  onStoreQueryChange: (q: string) => void;
  storePage: number;
  onStorePageChange: (p: number) => void;
  pageSize?: number;
  loading?: boolean;
};

function formatCell(colId: string, value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  if (colId === "STORE_ID" || colId === "CLUSTER_ID") return String(value);
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (isPercentStyleColumnId(colId)) return scalePercentLikeValue(n).toFixed(1);
  const a = Math.abs(n);
  if (colId === "NET_AMT_AVG_MONTHLY" || colId === "AVG_INVOICE_PURCHASE") {
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
    return n.toFixed(2);
  }
  if (colId === "PURCHASE_FREQ_PER_DAY") return n.toFixed(4);
  if (colId === "AVG_NO_DAYS_BETWEEN_PURCHASE") return n.toFixed(1);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function exportClusterStoresCsv(
  clusterId: number,
  columns: StoreColumn[],
  rows: StoreRow[],
): void {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.id];
        if (raw == null) return "";
        if (typeof raw === "number" && isPercentStyleColumnId(c.id)) {
          return csvEscape(String(scalePercentLikeValue(raw)));
        }
        return csvEscape(String(raw));
      })
      .join(","),
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cluster_${clusterId}_stores.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lightweight pager used under the stores metrics grid. */
function TablePagination({
  page,
  pageCount,
  onPageChange,
  disabled,
}: {
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || page <= 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-slate-300 transition enabled:hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-slate-500">
        {pageCount === 0 ? "0 of 0" : `${page + 1} of ${pageCount}`}
      </span>
      <button
        type="button"
        disabled={disabled || pageCount === 0 || page >= pageCount - 1}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-slate-300 transition enabled:hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export function ClusterStoreTable({
  clusterId,
  columns,
  rows,
  storeQuery,
  onStoreQueryChange,
  storePage,
  onStorePageChange,
  pageSize = CLUSTER_STORES_PAGE_SIZE,
  loading,
}: Props) {
  const q = storeQuery.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => String(r.STORE_ID ?? "").toLowerCase().includes(q))
    : rows;
  const pageCount = filtered.length === 0 ? 0 : Math.ceil(filtered.length / pageSize);
  const safePage =
    pageCount === 0 ? 0 : Math.min(Math.max(0, storePage), pageCount - 1);
  const start = safePage * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  // Keep parent page index in range when filter shrinks the result set.
  useEffect(() => {
    if (storePage !== safePage) onStorePageChange(safePage);
  }, [storePage, safePage, onStorePageChange]);

  return (
    <section className="rounded-2xl border border-surface-border/80 bg-surface-card/70 p-5 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-slate-100">
            Stores in Cluster {clusterId}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length.toLocaleString()} stores
            {q ? ` · ${filtered.length.toLocaleString()} match “${storeQuery.trim()}”` : ""}
            {pageCount > 0 ? ` · ${pageSize} per page` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={storeQuery}
              onChange={(e) => onStoreQueryChange(e.target.value)}
              placeholder="Search store ID…"
              className="w-full rounded-xl border border-surface-border bg-surface px-9 py-2 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <button
            type="button"
            onClick={() => exportClusterStoresCsv(clusterId, columns, filtered)}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-border bg-surface-raised/50 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-surface-raised disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {columns.length && (paged.length || loading) ? (
        <>
          <div className="mt-5 overflow-hidden rounded-xl border border-surface-border/70">
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[960px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-surface-border/80 bg-surface-raised/95 backdrop-blur-sm">
                    {columns.map((c) => (
                      <th
                        key={c.id}
                        className="whitespace-nowrap px-3 py-2.5 font-semibold uppercase tracking-wide text-slate-500"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => {
                    const storeId = String(row.STORE_ID ?? "");
                    return (
                      <tr
                        key={storeId}
                        className="border-b border-surface-border/40 transition hover:bg-surface-raised/30"
                      >
                        {columns.map((c) => (
                          <td key={c.id} className="whitespace-nowrap px-3 py-2 text-slate-300">
                            {c.id === "STORE_ID" ? (
                              <Link
                                to={`/recommendations?store=${encodeURIComponent(storeId)}`}
                                className="font-medium text-accent hover:underline"
                              >
                                {storeId}
                              </Link>
                            ) : (
                              <span className="font-mono tabular-nums">
                                {formatCell(c.id, row[c.id])}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-600">
              {filtered.length
                ? `Showing ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length.toLocaleString()}`
                : "Showing 0 of 0"}
              {filtered.length < rows.length
                ? ` (filtered from ${rows.length.toLocaleString()})`
                : ""}
            </p>
            <TablePagination
              page={safePage}
              pageCount={pageCount}
              onPageChange={onStorePageChange}
              disabled={loading || filtered.length === 0}
            />
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-slate-500">
          {loading
            ? "Loading stores…"
            : q
              ? "No stores match your search."
              : "No store-level metrics for this cluster."}
        </p>
      )}
    </section>
  );
}
