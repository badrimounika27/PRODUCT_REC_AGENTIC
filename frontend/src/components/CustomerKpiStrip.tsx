import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShoppingBag, Users, Filter, MousePointer } from "lucide-react";
import { fetchB2CSummary, type B2CSummary } from "../api";
import { Kpi } from "./Kpi";

/**
 * Compact B2C KPI strip rendered on the Dashboard.
 * Silent fallback to null if the B2C pipeline hasn't been run yet — this
 * keeps the B2B dashboard perfectly usable even without B2C data.
 */
export function CustomerKpiStrip() {
  const [data, setData] = useState<B2CSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchB2CSummary()
      .then((s) => {
        if (!cancelled) setData(s);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err && !data) {
    // Silent skip when B2C artifacts are missing.
    return null;
  }
  if (!data) {
    return (
      <section className="rounded-xl border border-surface-border bg-surface-card p-3">
        <p className="text-xs text-slate-500">Loading customer insights…</p>
      </section>
    );
  }

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const num = (v: number) => v.toLocaleString();

  return (
    <section className="rounded-xl border border-surface-border bg-surface-card px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Customers (B2C)
          </p>
          <h3 className="font-display text-sm font-semibold tracking-tight text-slate-100">
            Behavior snapshot
          </h3>
        </div>
        <Link
          to="/customers"
          className="group inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-raised px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
        >
          Explore
          <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi
          label="Customers"
          value={num(data.users)}
          sub={`${num(data.buyers)} buyers`}
          tone="indigo"
          icon={Users}
        />
        <Kpi
          label="Views (pv)"
          value={num(data.pv_count)}
          sub={`${num(data.buy_count)} buys`}
          tone="sky"
          icon={MousePointer}
        />
        <Kpi
          label="View → buy"
          value={pct(data.pv_to_buy_rate)}
          sub="Overall conversion"
          tone="emerald"
          icon={ShoppingBag}
        />
        <Kpi
          label="Cart → buy"
          value={pct(data.cart_to_buy_rate)}
          sub={`${num(data.cart_count)} carts`}
          tone="amber"
          icon={Filter}
        />
      </div>
    </section>
  );
}
