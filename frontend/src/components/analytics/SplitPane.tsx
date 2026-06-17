import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/**
 * SplitPane
 * ---------
 * Horizontal splitter that hosts exactly two children. A small pill-shaped drag
 * handle sits between them; dragging it adjusts the width split continuously.
 *
 * The split percentage is persisted in localStorage under `recai:split:<id>`,
 * so user-tuned layouts survive page reloads. On viewports below `lg` the two
 * children stack vertically (the splitter is hidden) — preserving responsive
 * behaviour from the original 2-column grid.
 */

type Props = {
  /** Stable id for localStorage persistence. */
  id: string;
  /** Initial split percentage (left child width %), default 50. */
  defaultSplitPct?: number;
  /** Minimum left/right width as a percentage. Default 22%. */
  minPct?: number;
  /** Tailwind gap value between the two panes (only used in stacked mode). */
  gapClass?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
  children: [ReactNode, ReactNode] | ReactNode[];
};

function readPersistedPct(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(JSON.parse(raw));
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

export function SplitPane({
  id,
  defaultSplitPct = 50,
  minPct = 22,
  gapClass = "gap-6",
  className = "",
  children,
}: Props) {
  const childArray = Array.isArray(children) ? children : [children];
  const left = childArray[0];
  const right = childArray[1];

  const storageKey = `recai:split:${id}`;
  const [pct, setPct] = useState<number>(() =>
    Math.max(minPct, Math.min(100 - minPct, readPersistedPct(storageKey, defaultSplitPct)))
  );

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ active: boolean }>({ active: false });

  const persist = useCallback(
    (next: number) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* quota / private mode — ignore */
      }
    },
    [storageKey]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current.active = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = e.clientX - rect.left;
    const next = Math.max(minPct, Math.min(100 - minPct, (x / rect.width) * 100));
    setPct(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    persist(pct);
  };

  const onDoubleClick = () => {
    setPct(50);
    persist(50);
  };

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`flex flex-col ${gapClass} lg:flex-row lg:gap-0 ${className}`}
      data-recai-split={id}
    >
      <div
        className="flex min-w-0 flex-col lg:pr-3"
        style={{ flexBasis: `${pct}%`, transition: dragRef.current.active ? "none" : "flex-basis 200ms ease-out" }}
      >
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize charts"
        aria-valuemin={minPct}
        aria-valuemax={100 - minPct}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            const next = Math.max(minPct, pct - 2);
            setPct(next);
            persist(next);
          } else if (e.key === "ArrowRight") {
            const next = Math.min(100 - minPct, pct + 2);
            setPct(next);
            persist(next);
          } else if (e.key === "Home") {
            setPct(50);
            persist(50);
          }
        }}
        title="Drag to resize · double-click to reset · ←/→ keys"
        className="hidden lg:flex shrink-0 items-center justify-center w-3 cursor-col-resize group"
      >
        <div className="flex h-12 w-1.5 items-center justify-center rounded-full bg-slate-700/70 group-hover:bg-sky-500/80 group-active:bg-sky-400 transition-colors duration-150 relative">
          <span className="absolute -left-1.5 text-[10px] leading-none text-slate-400 group-hover:text-sky-300 select-none pointer-events-none">
            ◀
          </span>
          <span className="absolute -right-1.5 text-[10px] leading-none text-slate-400 group-hover:text-sky-300 select-none pointer-events-none">
            ▶
          </span>
        </div>
      </div>

      <div
        className="flex min-w-0 flex-col lg:pl-3"
        style={{ flexBasis: `${100 - pct}%`, transition: dragRef.current.active ? "none" : "flex-basis 200ms ease-out" }}
      >
        {right}
      </div>
    </div>
  );
}
