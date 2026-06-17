import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, RefreshCw } from "lucide-react";

/**
 * ResizableChartCard
 * ------------------
 * Reusable chart container with a per-card toolbar in the top-right corner:
 *   - Refresh: re-runs the caller-supplied `onRefresh` callback (e.g. re-fetch data).
 *     Shows a spinning indicator while the promise is in flight.
 *   - Expand / Restore: toggles a fullscreen overlay; other charts dim behind a backdrop.
 *
 * Width-resize is handled by the surrounding `SplitPane` for paired charts (continuous,
 * pixel-level drag). Solo cards stay at their parent-determined width.
 *
 * Children are rendered exactly once and preserved across expand/restore — Recharts
 * tooltips, brushes, and legend selections remain intact.
 */

type ResizableCtx = {
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
};

const Ctx = createContext<ResizableCtx | null>(null);

/** Wrap a page subtree to coordinate expand/restore across cards. */
export function ResizableChartProvider({ children }: { children: ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expandedId]);

  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const value = useMemo(() => ({ expandedId, setExpandedId }), [expandedId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type Props = {
  /** Stable id used for context tracking and any future persistence. */
  id: string;
  title: string;
  subtitle?: string;
  /** Inline controls placed in the header (e.g. selectors). Rendered before the action icons. */
  headerExtra?: ReactNode;
  /** Extra classes for the outer card. Useful for parent-grid `col-span-*` overrides. */
  className?: string;
  /**
   * Tailwind class for the chart body height when collapsed (e.g. "h-72", "h-80").
   * In expanded state this is replaced with "flex-1 min-h-0" so charts fill the overlay.
   */
  bodyClassName?: string;
  /** Re-fetch / re-render hook. When provided, a refresh button appears in the toolbar. */
  onRefresh?: () => void | Promise<void>;
  children: ReactNode;
};

export function ResizableChartCard({
  id,
  title,
  subtitle,
  headerExtra,
  className = "",
  bodyClassName = "h-72",
  onRefresh,
  children,
}: Props) {
  const ctx = useContext(Ctx);
  const expandedId = ctx?.expandedId ?? null;
  const isExpanded = expandedId === id;
  const isOtherExpanded = expandedId !== null && !isExpanded;

  const [refreshing, setRefreshing] = useState(false);

  const handleExpandToggle = useCallback(() => {
    ctx?.setExpandedId(isExpanded ? null : id);
  }, [ctx, isExpanded, id]);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || refreshing) return;
    try {
      setRefreshing(true);
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  const containerStyle: CSSProperties = isExpanded
    ? {
        position: "fixed",
        top: "4vh",
        bottom: "4vh",
        left: "4vw",
        right: "4vw",
        zIndex: 60,
      }
    : {};

  const sectionClass = [
    "relative flex min-w-0 flex-col rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 shadow-sm",
    "transition-[opacity,box-shadow,border-color,transform] duration-300 ease-in-out",
    isExpanded ? "shadow-2xl shadow-sky-900/30 ring-1 ring-slate-600/40" : "",
    isOtherExpanded ? "pointer-events-none opacity-25" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const bodyClass = isExpanded ? "flex-1 min-h-0" : bodyClassName;

  return (
    <>
      {isExpanded
        ? createPortal(
            <div
              onClick={handleExpandToggle}
              className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm"
              style={{ animation: "recai-fade-in 280ms ease-out" }}
              aria-hidden
            />,
            document.body
          )
        : null}

      <section style={containerStyle} className={sectionClass} aria-label={title}>
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-700/60 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
            {subtitle ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerExtra}
            {onRefresh ? (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label={refreshing ? "Refreshing chart data" : "Refresh chart data"}
                title="Refresh"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/80 bg-slate-900/60 text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleExpandToggle}
              aria-label={isExpanded ? "Restore chart to original size" : "Expand chart to full screen"}
              title={isExpanded ? "Restore" : "Expand"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700/80 bg-slate-900/60 text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </header>

        <div className={`flex flex-col ${bodyClass}`}>{children}</div>
      </section>
    </>
  );
}
