import { BookOpen } from "lucide-react";
import type { InsightPayload } from "../api";

type Props = {
  insight: InsightPayload | null;
  loading?: boolean;
};

export function AIStoryCard({ insight, loading }: Props) {
  if (loading) {
    return (
      <div className="h-32 animate-pulse rounded-2xl border border-surface-border bg-surface-card" />
    );
  }
  if (!insight) return null;

  return (
    <section className="rounded-2xl border border-slate-500/25 bg-gradient-to-br from-slate-900/80 to-surface-card p-6">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-slate-300" />
        <h2 className="font-display text-lg font-semibold">Executive story</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{insight.insight}</p>
      {insight.key_points?.length ? (
        <ul className="mt-4 space-y-2 border-t border-surface-border pt-4 text-sm text-slate-400">
          {insight.key_points.slice(0, 5).map((k, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">{i + 1}.</span>
              {k}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
