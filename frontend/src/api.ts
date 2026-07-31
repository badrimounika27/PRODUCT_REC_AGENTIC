const parseJson = async (r: Response) => {
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<unknown>;
};

export type InsightPayload = {
  insight: string;
  key_points: string[];
  trends: string[];
  forecast_note: string;
  risks: string[];
  opportunities: string[];
  next_actions: string[];
};

export async function fetchSummary() {
  return (await parseJson(await fetch("/summary"))) as Record<string, unknown>;
}

export async function fetchClusterBreakdown() {
  return (await parseJson(await fetch("/analytics/cluster_breakdown"))) as {
    clusters: Array<Record<string, unknown>>;
  };
}

export type ClusterProfileColumn = { id: string; label: string; group: string };
export type ClusterProfileRow = {
  cluster_id: number;
  store_count: number;
  values: Record<string, number>;
};

export async function fetchClusterProfile() {
  return (await parseJson(await fetch("/analytics/cluster_profile"))) as {
    available: boolean;
    columns: ClusterProfileColumn[];
    rows: ClusterProfileRow[];
  };
}

export async function fetchForecastContext() {
  return (await parseJson(await fetch("/analytics/forecast_context"))) as Record<
    string,
    unknown
  >;
}

/** Exploratory analytics from transactions + featured_data (no AI). */
export async function fetchDashboardAnalytics() {
  return (await parseJson(await fetch("/analytics/dashboard"))) as Record<string, unknown>;
}

/** Monthly LINE_AMOUNT sum for one store (last up to 6 months from transactions). */
export async function fetchStoreSpendHistory(storeId: string) {
  return (await parseJson(
    await fetch(`/analytics/store/${encodeURIComponent(storeId)}/spend_history`),
  )) as {
    available: boolean;
    store_id: string;
    series: Array<{ period: string; spend: number }>;
  };
}

export async function fetchStores() {
  return (await parseJson(await fetch("/stores"))) as { stores: string[]; total: number };
}

/** L2 seasonality multipliers (months 1–12 as string keys) + meta. */
export async function fetchSeasonalityByCategory(category: string) {
  const q = encodeURIComponent(category);
  return (await parseJson(await fetch(`/seasonality/${q}`))) as {
    category: string;
    multipliers: Record<string, number>;
    best_month: number;
    worst_month: number;
    data_years_available: number;
    history_span_years: number;
  };
}

/** Single simulation row (authoritative base, beta, MRP from pipeline outputs). */
export async function fetchForecastSimulate(params: {
  store_id: string;
  sku_code: string;
  month: number;
  discount_pct: number;
}) {
  const sp = new URLSearchParams({
    store_id: params.store_id,
    sku_code: params.sku_code,
    month: String(params.month),
    discount_pct: String(params.discount_pct),
  });
  return (await parseJson(await fetch(`/forecast/simulate?${sp.toString()}`))) as {
    store_id: string;
    sku_code: string;
    month: number;
    discount_pct: number;
    l2_category: string;
    base_forecast_amt: number;
    seasonality_factor: number;
    amt_after_seasonality: number;
    promotional_multiplier: number;
    adjusted_forecast_amt: number;
    price_elasticity_beta: number;
    discount_adjustment: number;
    final_adjusted_amt: number;
    max_list_price: number;
    volume: number;
    signal: string;
    best_month: number;
    worst_month: number;
  };
}

export async function fetchSeasonalityL2Categories() {
  return (await parseJson(await fetch("/seasonality/l2_categories"))) as { categories: string[] };
}

export async function fetchSkuSearch(q: string) {
  const sp = new URLSearchParams({ q: q.trim() });
  return (await parseJson(await fetch(`/recommendations/sku_search?${sp}`))) as {
    skus: Array<{ SKU_CODE: string; PRODUCT_NAME: string }>;
    total: number;
  };
}

export async function fetchRecommendationsBySku(skuCode: string) {
  return (await parseJson(
    await fetch(`/recommendations/by_sku/${encodeURIComponent(skuCode)}`),
  )) as {
    sku_code: string;
    product_name: string;
    l2_category: string;
    store_count: number;
    recommendations: Record<string, unknown>[];
  };
}

export async function fetchRecommendations(storeId: string) {
  return (await parseJson(
    await fetch(`/recommendations/${encodeURIComponent(storeId)}`),
  )) as Record<string, unknown>;
}

export type RecommendationSummary = {
  store_id: string;
  cluster_id?: number;
  total_recommendations: number;
  top_confidence?: number | null;
  total_estimated_amount?: number | null;
  total_volume?: number | null;
};

export async function fetchRecommendationSummary(storeId: string) {
  return (await parseJson(
    await fetch(`/recommendations/${encodeURIComponent(storeId)}/summary`),
  )) as RecommendationSummary;
}

export async function fetchClusters() {
  return (await parseJson(await fetch("/clusters"))) as Array<{
    cluster_id: number;
    store_count: number;
  }>;
}

export async function fetchClusterDetail(clusterId: number) {
  return (await parseJson(await fetch(`/clusters/${clusterId}`))) as {
    cluster_id: number;
    store_count: number;
    stores: string[];
    top_recommended_skus: Array<Record<string, unknown>>;
    store_columns?: Array<{ id: string; label: string }>;
    store_rows?: Array<Record<string, string | number | null>>;
  };
}

export async function postInsightDashboard() {
  return (await parseJson(await fetch("/ai/insight/dashboard", { method: "POST" }))) as {
    insight: InsightPayload;
  };
}

export async function postInsightStore(storeId: string) {
  return (await parseJson(
    await fetch(`/ai/insight/store/${encodeURIComponent(storeId)}`, { method: "POST" }),
  )) as { insight: InsightPayload };
}

export async function postInsightCluster(clusterId: number) {
  return (await parseJson(
    await fetch(`/ai/insight/cluster/${clusterId}`, { method: "POST" }),
  )) as { insight: InsightPayload };
}

export async function postInsightForecast() {
  return (await parseJson(await fetch("/ai/insight/forecast", { method: "POST" }))) as {
    insight: InsightPayload;
  };
}

export async function postChat(messages: { role: string; content: string }[]) {
  return (await parseJson(
    await fetch("/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    }),
  )) as { reply: string };
}

export async function postExplainRecommendation(storeId: string, skuCode: string) {
  return (await parseJson(
    await fetch("/ai/explain/recommendation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: storeId, sku_code: skuCode }),
    }),
  )) as { explanation: string };
}

/* ============================================================================
 * B2C (customer-behavior) API — served by backend/api/b2c_routes.py
 * ==========================================================================*/

export type B2CSegmentSummary = {
  cluster_id: number;
  cluster_persona: string;
  user_count: number;
  share: number;
  avg_buy_count: number;
  avg_pv_count: number;
  avg_recency_days: number;
  avg_buy_share: number;
};

export type B2CSummary = {
  users: number;
  buyers: number;
  buyer_rate: number;
  total_events: number;
  pv_count: number;
  cart_count: number;
  fav_count: number;
  buy_count: number;
  pv_to_buy_rate: number;
  cart_to_buy_rate: number;
  unique_items: number;
  unique_categories: number;
  date_min?: string | null;
  date_max?: string | null;
  segments: Array<{
    cluster_id: number;
    cluster_persona: string;
    user_count: number;
    share: number;
  }>;
};

export type B2CCustomerListItem = {
  user_id: number;
  cluster_id: number;
  cluster_persona: string;
  total_events: number;
  buy_count: number;
  pv_count: number;
  recency_days: number;
  top_category: number;
};

export type B2CCustomerListResponse = {
  total: number;
  limit: number;
  offset: number;
  customers: B2CCustomerListItem[];
};

export type B2CCustomerDetail = {
  found: boolean;
  user_id: number;
  cluster_id?: number;
  cluster_persona?: string;
  features: Record<string, number | string>;
  top_recommendations: Array<{
    rank: number;
    item_id: number;
    score: number;
    reason: string;
  }>;
};

export type B2CSegmentDetail = {
  found: boolean;
  cluster_id: number;
  cluster_persona?: string;
  user_count: number;
  share: number;
  profile: Record<string, number>;
  top_items: Array<{ item_id: number; users: number; avg_score: number }>;
  sample_users: number[];
};

export type B2CFunnelResponse = {
  overall: Record<string, number | string | null>;
  by_date: Array<Record<string, number | string>>;
  top_categories: Array<Record<string, number | string>>;
};

export type B2CBundle = {
  item_a: number;
  item_b: number;
  pair_count: number;
  support: number;
  confidence: number;
  lift: number;
};

export type B2CBundleListResponse = {
  total: number;
  bundles: B2CBundle[];
};

export async function fetchB2CSummary() {
  return (await parseJson(await fetch("/api/b2c/summary"))) as B2CSummary;
}

export async function fetchB2CCustomers(params: {
  limit?: number;
  offset?: number;
  segment?: number;
  persona?: string;
  minBuys?: number;
  sort?: "buy_count" | "pv_count" | "total_events" | "recency_days" | "user_id";
  order?: "asc" | "desc";
} = {}) {
  const sp = new URLSearchParams();
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.segment != null) sp.set("segment", String(params.segment));
  if (params.persona) sp.set("persona", params.persona);
  if (params.minBuys != null) sp.set("min_buys", String(params.minBuys));
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  const qs = sp.toString();
  const url = qs ? `/api/b2c/customers?${qs}` : "/api/b2c/customers";
  return (await parseJson(await fetch(url))) as B2CCustomerListResponse;
}

export async function fetchB2CCustomer(userId: number) {
  return (await parseJson(
    await fetch(`/api/b2c/customers/${encodeURIComponent(String(userId))}`),
  )) as B2CCustomerDetail;
}

export async function fetchB2CSegments() {
  return (await parseJson(await fetch("/api/b2c/segments"))) as {
    segments: B2CSegmentSummary[];
  };
}

export async function fetchB2CSegmentDetail(clusterId: number, sampleSize = 25) {
  const sp = new URLSearchParams({ sample_size: String(sampleSize) });
  return (await parseJson(
    await fetch(`/api/b2c/segments/${clusterId}?${sp.toString()}`),
  )) as B2CSegmentDetail;
}

export async function fetchB2CFunnel(topCategories = 15) {
  const sp = new URLSearchParams({ top_categories: String(topCategories) });
  return (await parseJson(await fetch(`/api/b2c/funnel?${sp.toString()}`))) as B2CFunnelResponse;
}

export async function fetchB2CBundles(limit = 50, minLift = 0) {
  const sp = new URLSearchParams({ limit: String(limit), min_lift: String(minLift) });
  return (await parseJson(await fetch(`/api/b2c/bundles?${sp.toString()}`))) as B2CBundleListResponse;
}
