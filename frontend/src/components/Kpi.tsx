import type { ComponentType, SVGProps } from "react";

export type KpiTone =
  | "default"
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "cyan"
  | "sky"
  | "fuchsia";

export type KpiProps = {
  label: string;
  value: string;
  sub?: string;
  trendPct?: number | null;
  trendLabel?: string;
  tone?: KpiTone;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

// Tones only color the small icon pill in the corner. Card surface, border and
// text stay neutral — matching the Dashboard's minimal aesthetic.
const ICON_TONE: Record<KpiTone, { bg: string; text: string }> = {
  default: { bg: "bg-slate-700/40", text: "text-slate-300" },
  indigo: { bg: "bg-indigo-500/15", text: "text-indigo-300" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  amber: { bg: "bg-amber-500/15", text: "text-amber-300" },
  rose: { bg: "bg-rose-500/15", text: "text-rose-300" },
  violet: { bg: "bg-violet-500/15", text: "text-violet-300" },
  cyan: { bg: "bg-cyan-500/15", text: "text-cyan-300" },
  sky: { bg: "bg-sky-500/15", text: "text-sky-300" },
  fuchsia: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-300" },
};

export function Kpi({
  label,
  value,
  sub,
  trendPct,
  trendLabel,
  tone = "default",
  icon: Icon,
}: KpiProps) {
  const hasTrend = trendPct != null && Number.isFinite(trendPct);
  const positive = (trendPct ?? 0) >= 0;
  const arrow = positive ? "↑" : "↓";
  const trendText = hasTrend
    ? `${arrow} ${Math.abs(trendPct ?? 0).toFixed(1)}% ${trendLabel ?? ""}`.trim()
    : null;

  const iconTone = ICON_TONE[tone];

  return (
    <div className="relative flex min-w-0 flex-col justify-between rounded-lg border border-surface-border bg-surface-raised/60 px-2.5 py-2 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-500/70 hover:bg-surface-raised hover:shadow-md hover:shadow-black/20 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-start justify-between gap-2">
        <p
          className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500"
          title={label}
        >
          {label}
        </p>
        {Icon ? (
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${iconTone.bg} ${iconTone.text}`}
          >
            <Icon className="h-3 w-3" aria-hidden />
          </span>
        ) : null}
      </div>
      <p
        className="mt-1 truncate font-mono text-base font-semibold tabular-nums text-slate-100"
        title={value}
      >
        {value}
      </p>
      {trendText ? (
        <p
          className={`mt-0.5 truncate text-[10px] font-medium ${
            positive
              ? "text-emerald-500 dark:text-emerald-400"
              : "text-rose-500 dark:text-rose-400"
          }`}
        >
          {trendText}
        </p>
      ) : null}
      {sub ? (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-500">{sub}</p>
      ) : null}
    </div>
  );
}
