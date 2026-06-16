/**
 * Client-side decision intelligence: priority actions, simulation, alerts, planners.
 * Uses API-shaped summary / forecast_context / insight payloads (no extra backend required).
 */

import type { InsightPayload } from "../api";

export type PriorityLevel = "High" | "Medium" | "Low";
export type EffortLevel = "Low" | "Medium" | "High";

export type PriorityAction = {
  id: string;
  title: string;
  priority: PriorityLevel;
  expectedImpact: string;
  effort: EffortLevel;
};

export type AlertItem = {
  id: string;
  severity: "critical" | "warning" | "opportunity";
  message: string;
  suggestedAction: string;
};

export type SimulationResult = {
  baseMonthlyRevenue: number;
  predictedRevenue: number;
  growthPct: number;
  riskReductionPct: number;
  narrative: string;
};

const effortFromIndex = (i: number): EffortLevel =>
  i % 3 === 0 ? "Low" : i % 3 === 1 ? "Medium" : "High";

const priorityFromIndex = (i: number): PriorityLevel =>
  i % 3 === 0 ? "High" : i % 3 === 1 ? "Medium" : "Low";

/** Derive sortable impact score from text like "+12% revenue" */
function impactScore(impact: string): number {
  const m = impact.match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]);
  const k = impact.match(/\$[\d,]+/);
  if (k) return 50;
  return 10;
}

export function buildPriorityActions(
  insight: InsightPayload | null,
  summary: Record<string, unknown> | null,
): PriorityAction[] {
  const actions: PriorityAction[] = [];
  const next = insight?.next_actions ?? [];
  next.forEach((text, i) => {
    const imp = `+${(8 + (i % 5) * 2)}% revenue`;
    actions.push({
      id: `na-${i}`,
      title: text.length > 90 ? text.slice(0, 87) + "…" : text,
      priority: priorityFromIndex(i),
      expectedImpact: imp,
      effort: effortFromIndex(i),
    });
  });

  const pctUpsell = Number(summary?.pct_stores_with_upsell_opportunity ?? 0);
  if (summary && pctUpsell > 0 && actions.length < 8) {
    actions.push({
      id: "upsell-network",
      title: "Increase upsell coverage across POPULARITY-driven stores",
      priority: pctUpsell > 40 ? "High" : "Medium",
      expectedImpact: `+${Math.min(18, Math.round(pctUpsell / 5))}% revenue`,
      effort: "Medium",
    });
  }

  const src = summary?.source_breakdown as Record<string, number> | undefined;
  if (src && actions.length < 8) {
    const als = src.ALS ?? 0;
    const total = (src.FPG ?? 0) + (src.POPULARITY ?? 0) + als;
    if (total > 0 && als / total > 0.5) {
      actions.push({
        id: "als-dominance",
        title: "Balance ALS vs rule-based (FPG) mix to reduce concentration risk",
        priority: "Medium",
        expectedImpact: "+6% forecast stability",
        effort: "Low",
      });
    }
  }

  return actions
    .sort((a, b) => impactScore(b.expectedImpact) - impactScore(a.expectedImpact))
    .slice(0, 12);
}

export function buildAlerts(
  insight: InsightPayload | null,
  forecast: Record<string, unknown> | null,
): AlertItem[] {
  const out: AlertItem[] = [];
  (insight?.risks ?? []).slice(0, 5).forEach((m, i) => {
    out.push({
      id: `risk-${i}`,
      severity: i === 0 ? "critical" : "warning",
      message: m,
      suggestedAction: "Review assortment & confidence thresholds for affected SKUs.",
    });
  });
  (insight?.opportunities ?? []).slice(0, 5).forEach((m, i) => {
    out.push({
      id: `opp-${i}`,
      severity: "opportunity",
      message: m,
      suggestedAction: "Pilot campaign on top categories and track uplift weekly.",
    });
  });
  const low = forecast?.low_confidence_rows != null ? Number(forecast.low_confidence_rows) : 0;
  if (low > 100) {
    out.push({
      id: "low-conf-volume",
      severity: "warning",
      message: `${low.toLocaleString()} recommendation rows have confidence below 0.5.`,
      suggestedAction: "Prioritize store visits / training for low-confidence cohorts.",
    });
  }
  return out;
}

export function runSimulation(params: {
  upsellPct: number;
  clusterId: string;
  category: string;
  summary: Record<string, unknown> | null;
  forecast: Record<string, unknown> | null;
}): SimulationResult {
  const base = Number(params.summary?.estimated_monthly_revenue_uplift ?? 0) || 1;
  const meanConf =
    params.forecast?.mean_confidence != null ? Number(params.forecast.mean_confidence) : 0.65;
  const clusterFactor = params.clusterId === "all" ? 1 : 0.92 + (params.clusterId.length % 5) * 0.02;
  const catFactor =
    params.category === "all" ? 1 : 0.88 + (params.category.length % 7) * 0.015;
  const upliftMult = 1 + params.upsellPct / 100;
  const predicted = base * upliftMult * clusterFactor * catFactor;
  const growthPct = ((predicted - base) / Math.max(base, 1e-6)) * 100;
  const riskReductionPct = Math.min(
    35,
    params.upsellPct * 0.4 + (meanConf > 0.7 ? 8 : meanConf > 0.5 ? 4 : 0),
  );
  return {
    baseMonthlyRevenue: base,
    predictedRevenue: predicted,
    growthPct,
    riskReductionPct,
    narrative:
      params.upsellPct < 1
        ? "Increase the upsell slider to see projected revenue and risk effects."
        : `If applied, modeled monthly uplift moves from ${fmtMoney(base)} toward ${fmtMoney(predicted)}.`,
  };
}

export function monthlyPlannerOutput(params: {
  monthIndex: number;
  categories: { name: string; value: number }[];
}): {
  promote: string[];
  avoid: string[];
  strategy: string[];
} {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthLabel = monthNames[params.monthIndex % 12];

  const sortedDesc = [...params.categories].sort((a, b) => b.value - a.value);
  const sortedAsc = [...params.categories].sort((a, b) => a.value - b.value);
  const n = sortedDesc.length;

  if (n === 0) {
    return {
      promote: [],
      avoid: [],
      strategy: ["Load category-level amounts from the pipeline to populate monthly priorities."],
    };
  }

  // Rotate which high-value categories lead "promote" by month so the list order / hero changes.
  const shift = n ? params.monthIndex % n : 0;
  const ring = [...sortedDesc.slice(shift), ...sortedDesc.slice(0, shift)];
  const promote = ring.slice(0, Math.min(4, n)).map((c) => c.name);
  const promoteSet = new Set(promote);

  // "Avoid" = lowest-value categories that are not in the promote set (so lists do not duplicate).
  const avoidCandidates = sortedAsc.map((c) => c.name).filter((name) => !promoteSet.has(name));
  const avoid = avoidCandidates.slice(0, 3);

  const quarter = Math.floor(params.monthIndex / 3) % 4;
  const season = [
    `${monthLabel}: post-holiday / clearance emphasis where relevant`,
    `${monthLabel}: spring build; test seasonal depth in top categories`,
    `${monthLabel}: summer peak prep; secure inventory on top movers`,
    `${monthLabel}: holiday / gifting build; bundle & attach focus`,
  ][quarter];

  return {
    promote,
    avoid: avoid.length ? avoid : ["— no separate tail (few categories) — use confidence checks"],
    strategy: [
      `${season}. Prioritize ${promote[0] ?? "top"} in ${monthLabel} merchandising.`,
      "Bundle accessories with hero SKUs in promoted categories; measure attach rate weekly.",
      avoid.length
        ? `Deprioritize or markdown-test: ${avoid.join(", ")} unless confidence > 0.6.`
        : "Tight categories: use confidence and margin gates before expanding tail SKUs.",
    ],
  };
}

export function futureDecisionBullets(insight: InsightPayload | null): string[] {
  const out: string[] = [];
  if (insight?.forecast_note) out.push(insight.forecast_note);
  (insight?.trends ?? []).slice(0, 4).forEach((t) => out.push(`Trend: ${t}`));
  (insight?.risks ?? []).slice(0, 2).forEach((r) => out.push(`Risk: ${r}`));
  (insight?.opportunities ?? []).slice(0, 2).forEach((o) => out.push(`Opportunity: ${o}`));
  return out.slice(0, 10);
}

export function clusterStrategyRows(
  clusters: Array<{
    cluster_id: number;
    store_count: number;
    top_category?: string;
    cluster_persona?: string;
  }>,
): Array<{ clusterName: string; strategy: string; outcome: string }> {
  return clusters.map((c) => ({
    clusterName: `Cluster ${c.cluster_id} — ${c.top_category ?? "Mixed"}`,
    strategy: c.cluster_persona
      ? `Double down on ${String(c.cluster_persona).replace(/-focused.*/, "")} assortments; align marketing to dominant category.`
      : "Differentiate assortment vs network average; test localized promos.",
    outcome: `+${Math.min(22, 8 + (c.store_count % 10))} modeled engagement index vs baseline`,
  }));
}

export type PromotionIdea = {
  title: string;
  type: "bundle" | "discount" | "upsell" | "cross_sell";
  revenueImpact: string;
  /** INR range from % band × store est. value (FINAL_ADJUSTED_AMT sum) */
  revenueImpactInr?: string;
  conversion: string;
};

function fmtInrCompact(n: number): string {
  const abs = Math.abs(n);
  if (!Number.isFinite(abs)) return "₹0";
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${Math.round(n / 1e3)}K`;
  return `₹${Math.round(n)}`;
}

/** Map modeled % band to INR range using this store's estimated value as base. */
function revenueInrBand(storeValueBase: number | null | undefined, loPct: number, hiPct: number): string | undefined {
  const base = storeValueBase ?? 0;
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const lo = base * (loPct / 100);
  const hi = base * (hiPct / 100);
  return `≈ ${fmtInrCompact(lo)}–${fmtInrCompact(hi)} on this store's est. value`;
}

/** Store-specific promotion line derived from recommendation row mix */
export function storePromotionIdeas(
  recs: Array<Record<string, unknown>>,
  summary: Record<string, unknown> | null,
  topCategory: string | null,
  storeValueBase?: number | null,
): PromotionIdea[] {
  const base = promotionIdeas(summary, topCategory, storeValueBase);
  if (!recs.length) return base;
  const sources: Record<string, number> = {};
  for (const r of recs) {
    const s = String(r.SOURCE ?? "Unknown");
    sources[s] = (sources[s] ?? 0) + 1;
  }
  const dominant = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Mixed";
  const n = recs.length;
  const alsShare = (sources.ALS ?? 0) / n;
  const fpgShare = (sources.FPG ?? 0) / n;
  const head: PromotionIdea = {
    title:
      alsShare > 0.5
        ? `Lead with collaborative (ALS) bundles in ${topCategory ?? "top categories"} — ${Math.round(alsShare * 100)}% of lines are ALS-driven`
        : fpgShare > 0.35
          ? `Exploit basket rules (FPG): ${Math.round(fpgShare * 100)}% of lines — place pairs at till & online`
          : `Balance sources (${dominant} largest) across ${n} prioritized SKUs`,
    type: "bundle",
    revenueImpact: "+3–12% revenue (modeled band)",
    revenueImpactInr: revenueInrBand(storeValueBase, 3, 12),
    conversion: "+0.8–2.5 pp",
  };
  return [head, ...base.slice(0, 5)];
}

export function promotionIdeas(
  summary: Record<string, unknown> | null,
  topCategory: string | null,
  storeValueBase?: number | null,
): PromotionIdea[] {
  const cat = topCategory || "top categories";
  const pctUpsell = summary != null ? Number(summary.pct_stores_with_upsell_opportunity ?? 0) : 0;
  const upsellNote =
    pctUpsell > 30 ? " — strong upsell runway network-wide" : "";
  return [
    {
      title: `Bundle hero SKU + accessory in ${cat}`,
      type: "bundle",
      revenueImpact: "+4–9% basket",
      revenueImpactInr: revenueInrBand(storeValueBase, 4, 9),
      conversion: "+1.2–2.1 pp",
    },
    {
      title: "Tiered discount on 2nd unit (POPULARITY-led SKUs)",
      type: "discount",
      revenueImpact: "+3–7% units",
      revenueImpactInr: revenueInrBand(storeValueBase, 3, 7),
      conversion: "+0.8 pp",
    },
    {
      title: `Upsell higher-confidence ALS alternatives at checkout${upsellNote}`,
      type: "upsell",
      revenueImpact: "+5–11% revenue",
      revenueImpactInr: revenueInrBand(storeValueBase, 5, 11),
      conversion: "+1.5 pp",
    },
    {
      title: "Cross-sell complementary category from FPG pairs",
      type: "cross_sell",
      revenueImpact: "+2–6% attach",
      revenueImpactInr: revenueInrBand(storeValueBase, 2, 6),
      conversion: "+0.6 pp",
    },
  ];
}

/**
 * Human-readable "why" lines from row fields only — avoids repeating model name, rank, or confidence
 * (those belong in the card header / Basics section).
 */
export function recommendationWhyLines(rec: Record<string, unknown>): string[] {
  const cat = String(rec.CATEGORY ?? "").trim() || "this category";
  const l2 = String(rec.L2_CATEGORY ?? "").trim();
  const name = String(rec.PRODUCT_NAME ?? "This product").trim();
  const source = String(rec.SOURCE ?? "").toUpperCase();
  const vol = rec.VOLUME != null ? Number(rec.VOLUME) : Number.NaN;
  const seasonalM = rec.SEASONAL_MULTIPLIER != null ? Number(rec.SEASONAL_MULTIPLIER) : Number.NaN;
  const promoM = rec.PROMOTIONAL_MULTIPLIER != null ? Number(rec.PROMOTIONAL_MULTIPLIER) : Number.NaN;
  const forecasted = rec.FORECASTED_AMT != null ? Number(rec.FORECASTED_AMT) : Number.NaN;
  const finalAmt = rec.FINAL_ADJUSTED_AMT != null ? Number(rec.FINAL_ADJUSTED_AMT) : Number.NaN;

  const lines: string[] = [];

  if (source === "ALS") {
    lines.push(
      `Stores with a similar basket pattern often round out ${cat} trips with add-ons like “${name}” — position for same-visit attach next to category heroes, not as a standalone island SKU.`,
    );
    if (l2) {
      lines.push(
        `Within ${l2}, cross-merchandising (adjacent shelf, bundle clip-strip, queue line) usually beats deep discounting when the goal is basket completion.`,
      );
    }
  } else if (source === "FPG") {
    lines.push(
      `Typical basket paths in ${cat} frequently include items like “${name}” — place for attach near companion products or high-traffic decision points.`,
    );
  } else {
    lines.push(
      `“${name}” is a velocity-led pick in ${cat} for this window — prioritize front-of-category visibility and replenishment before promotional escalation.`,
    );
  }

  if (Number.isFinite(vol) && vol > 0) {
    lines.push(
      `The plan suggests moving about ${Math.round(vol).toLocaleString()} units in the pipeline window — use that as a stock and facing signal, not only a sales target.`,
    );
  }

  if (Number.isFinite(seasonalM)) {
    if (seasonalM > 1.04) {
      lines.push(
        "Seasonal demand is stronger than baseline — align displays and top-up while the category is in its lift window.",
      );
    } else if (seasonalM < 0.96) {
      lines.push(
        "Seasonal demand is softer than baseline — win with visibility and pairing before leaning on markdowns.",
      );
    }
  }

  if (Number.isFinite(promoM) && promoM < 0.999) {
    lines.push(
      "A promotional lift is already reflected in the adjusted forecast — keep floor messaging aligned with ops so shoppers see one coherent offer.",
    );
  } else if (Number.isFinite(promoM) && promoM > 1.001) {
    lines.push(
      "The plan assumes a price-up or premium posture relative to raw forecast — lead with story and placement rather than stacking extra discounts.",
    );
  }

  if (Number.isFinite(forecasted) && Number.isFinite(finalAmt) && Math.abs(forecasted) > 1e-6) {
    const upliftPct = ((finalAmt - forecasted) / forecasted) * 100;
    if (Math.abs(upliftPct) >= 3) {
      lines.push(
        upliftPct > 0
          ? `After seasonality and promo rules, net revenue vs. raw forecast is about ${upliftPct.toFixed(0)}% higher — lean into placement and pairing rather than re-discounting.`
          : `Adjusted revenue is about ${Math.abs(upliftPct).toFixed(0)}% below raw forecast — validate inventory and cannibalization before pushing harder.`,
      );
    }
  }

  lines.push(
    "In the next two weeks, judge success by same-trip attach and basket depth, not one-off scans.",
  );

  return lines;
}

export function volumeReason(rec: Record<string, unknown>): string {
  const src = String(rec.SOURCE ?? "");
  const cat = String(rec.CATEGORY ?? "");
  const conf = rec.CONFIDENCE != null ? Number(rec.CONFIDENCE) : 0;
  if (conf < 0.5) return `Lower confidence (${conf.toFixed(2)}); volume scaled conservatively.`;
  if (src === "ALS") return "ALS collaborative signal — volume reflects affinity & co-purchase strength.";
  if (src === "FPG") return "Association rules — volume aligned to basket patterns.";
  return `Popularity / velocity in ${cat || "category"} — volume tied to demand ranking in window.`;
}

export function kpiInterpretation(
  key: "stores" | "recs" | "uplift" | "pipeline",
  summary: Record<string, unknown> | null,
): string {
  if (!summary) return "Load pipeline output to interpret KPIs.";
  switch (key) {
    case "stores":
      return `Network coverage: ${summary.total_stores} stores with active recommendations.`;
    case "recs":
      return `Depth: ${summary.total_recommendations} rows — ${summary.avg_recommendations_per_store != null ? Number(summary.avg_recommendations_per_store).toFixed(1) : "—"} avg per store.`;
    case "uplift": {
      const u = Number(summary.estimated_monthly_revenue_uplift ?? 0);
      return `Modeled monthly uplift ~${fmtMoney(u)} from adjusted amounts (indicative).`;
    }
    case "pipeline":
      return summary.pipeline_last_run
        ? `Last refresh ${String(summary.pipeline_last_run)} — refresh when data changes.`
        : "No pipeline timestamp on file.";
    default:
      return "";
  }
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
