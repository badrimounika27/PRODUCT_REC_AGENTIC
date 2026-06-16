/**
 * API/pipeline may store proportions as fractions (0–1) or as 0–100.
 * For display as a plain number (no % suffix), scale fractions by 100.
 * Values with |v| > 1 are treated as already on a 0–100-style scale.
 */
export function scalePercentLikeValue(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v === 0) return 0;
  if (Math.abs(v) <= 1) return v * 100;
  return v;
}

export function isPercentStyleColumnId(columnId: string): boolean {
  return columnId.endsWith("_PCT") || columnId.includes("SALES_PCT");
}
