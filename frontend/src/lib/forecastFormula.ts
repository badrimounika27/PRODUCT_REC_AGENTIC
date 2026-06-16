/** Fallback β when promo elasticity CSV has no valid row (matches API). */
export const DEFAULT_SCENARIO_BETA = 0.18;

/** Matches api/forecast_routes.py — unitless factor (elasticity × discount %). */
export function discountAdjustment(beta: number, discountPct: number): number {
  return Math.max(1 - (beta * discountPct) / 100, 0.01);
}

/** Volume ≈ adjusted forecasted amount ÷ list price; min 1 unit (pipeline step 11). */
export function forecastVolumeFromComponents(
  base: number,
  seasonMult: number,
  promoMult: number,
  discAdj: number,
  mrp: number,
): number {
  if (!(mrp > 0)) return 1;
  const v = Math.round((base * seasonMult * promoMult * discAdj) / mrp);
  return Math.max(v, 1);
}

export function signalFor(
  mult: number,
  bestMonth: number,
  month: number,
): "best" | "push" | "wait" {
  if (month === bestMonth) return "best";
  if (mult >= 1) return "push";
  return "wait";
}

export function signalLabel(sig: "best" | "push" | "wait"): string {
  if (sig === "best") return "Strongest month";
  if (sig === "push") return "Above baseline";
  return "Softer demand";
}
