import { Megaphone, Package, Percent, Shuffle } from "lucide-react";
import { promotionIdeas, storePromotionIdeas } from "../lib/decisionIntel";

const icon = {
  bundle: Package,
  discount: Percent,
  upsell: Megaphone,
  cross_sell: Shuffle,
};

type Props = {
  summary: Record<string, unknown> | null;
  focusCategory: string | null;
  /** When set, first row is tailored to this store's recommendation mix */
  recommendations?: Record<string, unknown>[];
  /** Sum of FINAL_ADJUSTED_AMT for this store — used to show ₹ impact alongside % bands */
  storeValueBase?: number | null;
};

export function PromotionStrategyPanel({
  summary,
  focusCategory,
  recommendations,
  storeValueBase,
}: Props) {
  const ideas =
    recommendations && recommendations.length > 0
      ? storePromotionIdeas(recommendations, summary, focusCategory, storeValueBase)
      : promotionIdeas(summary, focusCategory, storeValueBase);

  return (
    <section className="rounded-2xl border border-amber-500/25 bg-amber-950/10 p-6">
      <h2 className="font-display text-lg font-semibold">Promotion strategy agent</h2>
      <p className="mt-1 text-xs text-slate-500">
        Bundle, discount, upsell &amp; cross-sell plays with modeled impact bands.
      </p>
      <ul className="mt-4 space-y-3">
        {ideas.map((p, i) => {
          const Icon = icon[p.type];
          return (
            <li
              key={i}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-surface-border bg-surface-card px-4 py-3"
            >
              <div className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <p className="font-medium text-slate-100">{p.title}</p>
                  <p className="text-[11px] uppercase text-slate-600">{p.type.replace("_", " ")}</p>
                </div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <p>
                  <span className="text-mint">Rev</span> {p.revenueImpact}
                </p>
                {p.revenueImpactInr ? (
                  <p className="mt-0.5 font-medium text-amber-200/90">{p.revenueImpactInr}</p>
                ) : null}
                <p>
                  <span className="text-sky-400">Conv</span> {p.conversion}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
