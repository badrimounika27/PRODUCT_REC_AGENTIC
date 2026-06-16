import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, Sparkles } from "lucide-react";
import type { AlertItem } from "../lib/decisionIntel";

type Props = {
  alerts: AlertItem[];
};

export function AlertPanel({ alerts }: Props) {
  if (!alerts.length) {
    return (
      <div className="rounded-2xl border border-surface-border bg-surface-card/50 p-4 text-sm text-slate-500">
        No structured alerts — insights will populate risks and opportunities when AI is available.
      </div>
    );
  }

  const critical = alerts.filter((a) => a.severity === "critical");
  const warnings = alerts.filter((a) => a.severity === "warning");
  const opps = alerts.filter((a) => a.severity === "opportunity");

  return (
    <section className="rounded-2xl border border-surface-border bg-surface-card p-6">
      <h2 className="font-display text-lg font-semibold">Alerts &amp; monitoring</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <AlertColumn
          title="Critical risks"
          icon={<AlertOctagon className="h-5 w-5 text-red-400" />}
          items={critical}
          tone="border-red-500/25 bg-red-950/20"
        />
        <AlertColumn
          title="Warnings"
          icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
          items={warnings}
          tone="border-amber-500/25 bg-amber-950/15"
        />
        <AlertColumn
          title="Opportunities"
          icon={<Sparkles className="h-5 w-5 text-emerald-400" />}
          items={opps}
          tone="border-emerald-500/25 bg-emerald-950/15"
        />
      </div>
    </section>
  );
}

function AlertColumn({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: ReactNode;
  items: AlertItem[];
  tone: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        {icon}
        {title}
      </div>
      <ul className="mt-3 space-y-3 text-xs text-slate-400">
        {items.length ? (
          items.map((a) => (
            <li key={a.id} className="rounded-lg bg-black/20 p-2">
              <p className="text-slate-200">{a.message}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                <span className="text-slate-400">Suggested:</span> {a.suggestedAction}
              </p>
            </li>
          ))
        ) : (
          <li className="text-slate-600">None in this band.</li>
        )}
      </ul>
    </div>
  );
}
