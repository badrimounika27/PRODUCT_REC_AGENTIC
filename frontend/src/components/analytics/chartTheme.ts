/**
 * Shared palettes and tooltip styling for analytics charts — distinct, professional, readable on dark UI.
 */

import type { CSSProperties } from "react";

/**
 * Tooltip: theme-aware content styling.
 *
 * Uses CSS custom properties defined in index.css so the tooltip flips
 * automatically between light and dark themes without any React
 * re-render — the browser re-evaluates `rgb(var(--...))` on every paint.
 *
 * `cursor: false` disables Recharts' bar/line cursor so no highlight
 * rectangle or guideline is drawn behind hovered elements. The tooltip
 * popup itself still animates in smoothly on hover.
 */
export const chartTooltipProps = {
  cursor: false,
  contentStyle: {
    background: "rgb(var(--color-surface-card))",
    border: "1px solid rgb(var(--color-surface-border))",
    borderRadius: "8px",
    fontSize: "12px",
    color: "rgb(var(--color-slate-100))",
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.15)",
  } satisfies CSSProperties,
  labelStyle: {
    color: "rgb(var(--color-slate-200))",
    fontWeight: 600,
    marginBottom: "4px",
  },
  itemStyle: {
    color: "rgb(var(--color-slate-300))",
  },
  animationDuration: 180,
};

/**
 * Compact number formatter for Y-axis ticks that would otherwise clip
 * (e.g. "4,539,568" -> "4.5M"). Keeps axes narrow without needing extra
 * left-margin per chart.
 */
const _compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export function formatCompactNumber(v: number): string {
  if (v == null || Number.isNaN(v)) return "";
  return _compact.format(v);
}

/** Multi-series line charts — soft, muted hues (same families: teal, indigo, peach, rose, purple, sky, apricot, mint) */
export const SERIES_LINE_COLORS = [
  "#7dd3c8", // soft teal
  "#a5b8fc", // soft indigo / periwinkle
  "#fcd9a6", // light apricot
  "#f9b4c4", // light pink / dusty rose
  "#c9b8f5", // soft lavender
  "#9ddbef", // soft sky
  "#f5c49a", // light peach
  "#b8e5c8", // muted mint
];

/** Pie / category share — pastel, low-chroma, still distinguishable */
export const PIE_COLORS = [
  "#93c5fd", // soft blue
  "#7dd3d0", // soft teal
  "#fcd9a6", // light apricot
  "#f5b8d1", // soft pink
  "#c4b5fd", // soft violet
  "#a5e8f5", // soft cyan
  "#f5c49a", // light peach
  "#c8e6a0", // muted lime
  "#a5b8fc", // soft indigo
  "#f5b8b8", // soft coral
  "#d8b4fe", // soft purple
  "#9ddbef", // soft sky
];

/** Bar charts: muted spectrum aligned with line/pie families */
export const BAR_FILL_SPECTRUM = [
  "#94a3b8", // slate (neutral anchor)
  "#93c5fd",
  "#7dd3d0",
  "#c4b5fd",
  "#fcd9a6",
  "#f5b8d1",
  "#b8e5c8",
  "#f5c49a",
];

/** Monthly trend: soft sky area + warm peach line */
export const TREND = {
  areaFill: "#93c5fd",
  areaStroke: "#a8c8f8",
  lineOrders: "#e8c48a",
} as const;

/** Time-series lines — airy blue + soft purple */
export const TIME_SERIES = {
  revenue: "#a8c8f8",
  revenueRef: "#a1a7b3",
  orders: "#d4c4f0",
  ordersRef: "#a1a7b3",
} as const;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

type RGB = { r: number; g: number; b: number };

function lerpRgb(from: RGB, to: RGB, t: number): RGB {
  return {
    r: lerp(from.r, to.r, t),
    g: lerp(from.g, to.g, t),
    b: lerp(from.b, to.b, t),
  };
}

/** Normalized intensity 0–1 → green → yellow → orange → red (heatmap) */
export function heatmapIntensityColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const green: RGB = { r: 21, g: 128, b: 61 }; // emerald-700
  const yellow: RGB = { r: 161, g: 98, b: 7 }; // amber-700
  const orange: RGB = { r: 194, g: 65, b: 12 }; // orange-700
  const red: RGB = { r: 185, g: 28, b: 28 }; // red-700

  let rgb: RGB;
  if (x <= 1 / 3) {
    rgb = lerpRgb(green, yellow, x * 3);
  } else if (x <= 2 / 3) {
    rgb = lerpRgb(yellow, orange, (x - 1 / 3) * 3);
  } else {
    rgb = lerpRgb(orange, red, (x - 2 / 3) * 3);
  }
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

/** Text color for heatmap cell (readable on warm/cool fills) */
export function heatmapCellTextColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.45) return "rgba(255,255,255,0.92)";
  if (x < 0.72) return "rgba(15,23,42,0.95)";
  return "rgba(255,255,255,0.95)";
}
