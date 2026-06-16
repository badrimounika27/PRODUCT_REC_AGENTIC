type Props = {
  value: number;
  label?: string;
  max?: number;
};

export function ConfidenceGauge({ value, label = "Confidence", max = 1 }: Props) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color =
    pct >= 70 ? "from-emerald-500 to-mint" : pct >= 45 ? "from-amber-500 to-amber-400" : "from-red-500 to-orange-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="font-mono text-slate-300">{value.toFixed(3)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
