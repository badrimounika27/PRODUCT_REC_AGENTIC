type Stat = {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
};

type Props = {
  features: Record<string, Stat>;
};

/** Approximate quartiles from mean, median, std when raw quartiles are unavailable */
function quartiles(s: Stat): { q1: number; q3: number } {
  const q1 = Math.max(s.min, Math.min(s.median, s.mean - 0.675 * s.std));
  const q3 = Math.min(s.max, Math.max(s.median, s.mean + 0.675 * s.std));
  return { q1, q3 };
}

function pos(v: number, min: number, span: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(span) || span <= 0) return 50;
  return ((v - min) / span) * 100;
}

function BoxRow({ name, s }: { name: string; s: Stat }) {
  const span = s.max - s.min || 1e-9;
  const { q1, q3 } = quartiles(s);
  const lo = Math.min(q1, q3);
  const hi = Math.max(q1, q3);
  const leftPct = pos(lo, s.min, span);
  const widthPct = Math.max(pos(hi, s.min, span) - leftPct, 0.4);
  const medPct = pos(s.median, s.min, span);

  return (
    <div className="flex flex-col gap-1 border-b border-slate-800/80 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-full shrink-0 text-xs text-slate-300 sm:max-w-[220px]">{name}</div>
      <div className="relative h-10 min-w-0 flex-1">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-500" />
        <div
          className="absolute top-1/2 box-border h-6 -translate-y-1/2 rounded border border-sky-500/60 bg-sky-500/15"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
        <div
          className="absolute top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-amber-400"
          style={{ left: `${medPct}%` }}
          title={`Median: ${s.median}`}
        />
        <div className="absolute bottom-0 left-0 top-0 w-px bg-slate-400/90" title={`Min: ${s.min}`} />
        <div className="absolute bottom-0 right-0 top-0 w-px bg-slate-400/90" title={`Max: ${s.max}`} />
      </div>
      <div className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">
        min {s.min.toFixed(2)} · med {s.median.toFixed(2)} · max {s.max.toFixed(2)}
      </div>
    </div>
  );
}

export function FeatureInsightsBoxPlot({ features }: Props) {
  const entries = Object.entries(features);
  if (!entries.length) {
    return <p className="text-sm text-slate-600">Location-level detail is not available for this dataset yet.</p>;
  }

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/20 p-4">
      <p className="mb-3 text-[11px] text-slate-500">
        Distribution across stores: line spans min–max; box approximates IQR; amber bar is median.
      </p>
      <div>
        {entries.map(([name, s]) => (
          <BoxRow key={name} name={name} s={s} />
        ))}
      </div>
    </div>
  );
}
