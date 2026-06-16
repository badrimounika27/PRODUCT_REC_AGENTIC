import { Compass } from "lucide-react";

type Props = {
  bullets: string[];
  loading?: boolean;
};

export function FutureDecisionPanel({ bullets, loading }: Props) {
  if (loading) {
    return <div className="h-40 animate-pulse rounded-2xl border border-surface-border bg-surface-card" />;
  }

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-6">
      <div className="flex items-center gap-2">
        <Compass className="h-6 w-6 text-cyan-400" />
        <h2 className="font-display text-lg font-semibold">AI future decisions</h2>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Trends, best windows, risks, and opportunities synthesized from forecast context + insight.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-slate-300">
        {bullets.length ? (
          bullets.map((b, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-black/20 px-3 py-2">
              <span className="text-cyan-400">◆</span>
              <span>{b}</span>
            </li>
          ))
        ) : (
          <li className="text-slate-500">Load forecast insight to populate this panel.</li>
        )}
      </ul>
    </section>
  );
}
