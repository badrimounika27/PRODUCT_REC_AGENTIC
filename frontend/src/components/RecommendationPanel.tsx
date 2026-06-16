import { ListOrdered } from "lucide-react";
import { ExplainabilityDrawer } from "./ExplainabilityDrawer";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { volumeReason } from "../lib/decisionIntel";

type Rec = Record<string, unknown>;

type Props = {
  recommendations: Rec[];
  onExplain?: (sku: string) => void;
  explainingSku?: string | null;
  extraWhyBullets?: Record<string, string[]>;
};

export function RecommendationPanel({
  recommendations,
  onExplain,
  explainingSku,
  extraWhyBullets,
}: Props) {
  if (!recommendations.length) {
    return (
      <p className="text-sm text-slate-500">No recommendations for this selection.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-slate-400">
        <ListOrdered className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Prioritized · volume &amp; confidence
        </span>
      </div>
      <ul className="space-y-3">
        {recommendations.map((r, i) => {
          const sku = String(r.SKU_CODE ?? "");
          const name = String(r.PRODUCT_NAME ?? "—");
          const src = String(r.SOURCE ?? "—");
          const cat = String(r.CATEGORY ?? "—");
          const conf =
            r.CONFIDENCE !== undefined && r.CONFIDENCE !== null
              ? Number(r.CONFIDENCE)
              : NaN;
          const vol = r.VOLUME != null ? Number(r.VOLUME) : null;
          const whyBullets = [
            volumeReason(r),
            `Category: ${cat} · Source: ${src}`,
            ...(extraWhyBullets?.[sku] ?? []),
          ];

          return (
            <li
              key={`${sku}-${i}`}
              className="overflow-hidden rounded-xl border border-surface-border bg-surface-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-100">{name}</p>
                  <p className="text-xs text-slate-500">
                    {sku} · {src}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px] text-slate-400">
                      <span className="text-teal-400">📦 Volume</span>{" "}
                      {vol != null && Number.isFinite(vol)
                        ? `${Math.round(vol).toLocaleString()} units`
                        : "—"}{" "}
                      <span className="text-slate-600">· next 30 days</span>
                    </div>
                    <div className="rounded-lg bg-black/20 px-2 py-1.5 text-[11px]">
                      {!Number.isFinite(conf) ? (
                        <span className="text-slate-500">Confidence n/a</span>
                      ) : (
                        <ConfidenceGauge value={conf} label="Model confidence" />
                      )}
                    </div>
                  </div>
                </div>
                {onExplain ? (
                  <button
                    type="button"
                    onClick={() => onExplain(sku)}
                    disabled={explainingSku === sku}
                    className="shrink-0 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  >
                    {explainingSku === sku ? "…" : "Why this?"}
                  </button>
                ) : null}
              </div>
              <div className="border-t border-surface-border px-2 pb-2">
                <ExplainabilityDrawer title="Why this volume & rank?" bullets={whyBullets} compact />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
