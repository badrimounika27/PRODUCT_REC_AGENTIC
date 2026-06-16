import {
  BarChart3,
  Calendar,
  Layers,
  Lightbulb,
  Package,
  Sparkles,
  Tag,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { recommendationWhyLines } from "../lib/decisionIntel";

type Rec = Record<string, unknown>;

function num(r: Rec, key: string): number | null {
  const v = r[key];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtNum(n: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return n.toFixed(digits);
}

type Props = {
  rec: Rec;
  clusterId: number;
  index: number;
  onDeepExplain?: (sku: string) => void;
  deepExplanation?: string | null;
  explainingSku?: string | null;
};

export function StoreRecommendationCard({
  rec,
  clusterId,
  index,
  onDeepExplain,
  deepExplanation,
  explainingSku,
}: Props) {
  const sku = String(rec.SKU_CODE ?? "");
  const name = String(rec.PRODUCT_NAME ?? "—");
  const cat = String(rec.CATEGORY ?? "—");
  const l2 = String(rec.L2_CATEGORY ?? "");
  const source = String(rec.SOURCE ?? "—");
  const conf = num(rec, "CONFIDENCE");
  const rank = num(rec, "RANK");
  const vol = num(rec, "VOLUME");
  const forecasted = num(rec, "FORECASTED_AMT");
  const seasonalM = num(rec, "SEASONAL_MULTIPLIER");
  const afterSeason = num(rec, "FORECASTED_AMT_AFTER_SEASONALITY");
  const promoM = num(rec, "PROMOTIONAL_MULTIPLIER");
  const finalAmt = num(rec, "FINAL_ADJUSTED_AMT");
  const maxPrice = num(rec, "MAX_LIST_PRICE");
  const pipelineWhy = String(rec.EXPLAINABILITY ?? "").trim();

  const insightLines = useMemo(() => recommendationWhyLines(rec), [rec]);
  const isExplaining = explainingSku === sku;

  return (
    <article className="overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-sm">
      <div className="border-b border-surface-border/80 bg-surface-raised/30 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold text-slate-100">{name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">{sku}</p>
          </div>
          {rank != null ? (
            <span className="shrink-0 rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300">
              Rank #{Math.round(rank)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Tag className="h-3.5 w-3.5 text-sky-400" />
            Basics
          </h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Category</dt>
            <dd className="text-slate-200">{cat}</dd>
            {l2 ? (
              <>
                <dt className="text-slate-500">L2</dt>
                <dd className="text-slate-300">{l2}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Cluster</dt>
            <dd className="text-slate-200">{clusterId}</dd>
            <dt className="text-slate-500">Model</dt>
            <dd className="font-medium text-accent">{source}</dd>
            <dt className="flex items-center gap-1 text-slate-500">
              <BarChart3 className="h-3 w-3" />
              Confidence
            </dt>
            <dd>
              {conf != null ? <ConfidenceGauge value={conf} label="Score" /> : <span className="text-slate-500">—</span>}
            </dd>
          </dl>
        </section>

        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Forecast &amp; pricing
          </h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Forecast amount</dt>
            <dd className="tabular-nums text-slate-200">{fmtMoney(forecasted)}</dd>
            <dt className="text-slate-500">After seasonality</dt>
            <dd className="tabular-nums text-slate-200">{fmtMoney(afterSeason)}</dd>
            <dt className="text-slate-500">Seasonal mult.</dt>
            <dd className="tabular-nums">{fmtNum(seasonalM, 3)}</dd>
            <dt className="text-slate-500">Promo mult.</dt>
            <dd className="tabular-nums">{fmtNum(promoM, 3)}</dd>
            <dt className="text-slate-500">Final adjusted</dt>
            <dd className="font-medium tabular-nums text-mint">{fmtMoney(finalAmt)}</dd>
            <dt className="text-slate-500">Max list price</dt>
            <dd className="tabular-nums text-slate-300">{fmtMoney(maxPrice)}</dd>
          </dl>
        </section>

        <section className="space-y-2 md:col-span-2">
          <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Package className="h-3.5 w-3.5 text-amber-400" />
            Volume
          </h4>
          <div className="flex flex-wrap gap-4 rounded-xl border border-surface-border bg-surface/50 px-4 py-3">
            <div>
              <p className="text-[10px] uppercase text-slate-500">Recommended qty</p>
              <p className="text-lg font-semibold tabular-nums text-slate-100">
                {vol != null ? `${Math.round(vol).toLocaleString()} units` : "—"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Calendar className="h-4 w-4 shrink-0" />
              <div>
                <p className="text-[10px] uppercase text-slate-500">Time range</p>
                <p className="text-sm text-slate-300">Next 30 days (pipeline window)</p>
              </div>
            </div>
          </div>
        </section>

        <section className="md:col-span-2">
          <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Layers className="h-3.5 w-3.5 text-violet-400" />
            Seasonality context
          </h4>
          <p className="rounded-xl border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-sm leading-relaxed text-slate-300">
            Seasonal multiplier {fmtNum(seasonalM, 3)} adjusts the baseline forecast before promotional rules. Post-seasonality
            amount {fmtMoney(afterSeason)} flows into the final adjusted amount after promo multiplier {fmtNum(promoM, 3)}.
          </p>
        </section>

        <section className="md:col-span-2">
          <details className="group rounded-xl border border-accent/30 bg-accent/5 open:bg-accent/10" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-100 [&::-webkit-details-marker]:hidden">
              <Lightbulb className="h-4 w-4 text-amber-300" />
              Why this recommendation?
            </summary>
            <div className="space-y-3 border-t border-surface-border/80 p-4 pt-3">
              <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-200">
                {insightLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {pipelineWhy ? (
                <p className="border-t border-surface-border/60 pt-3 text-xs leading-relaxed text-slate-500">
                  <span className="font-medium text-slate-500">Pipeline note: </span>
                  {pipelineWhy}
                </p>
              ) : null}
              {onDeepExplain ? (
                <div className="border-t border-surface-border pt-3">
                  <button
                    type="button"
                    onClick={() => onDeepExplain(sku)}
                    disabled={isExplaining}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isExplaining ? "Generating…" : "Ask AI for a deeper explanation"}
                  </button>
                  {deepExplanation ? (
                    <p className="mt-3 text-sm leading-relaxed text-slate-300">{deepExplanation}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>
        </section>
      </div>

      <div className="border-t border-surface-border px-4 py-2 text-[10px] text-slate-600">
        Line {index + 1} · {sku}
      </div>
    </article>
  );
}
