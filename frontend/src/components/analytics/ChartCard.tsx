import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
};

export function ChartCard({ title, subtitle, children, className = "" }: Props) {
  return (
    <section
      className={`rounded-xl border border-slate-700/80 bg-slate-900/40 p-5 shadow-sm ${className}`}
    >
      <div className="mb-4 border-b border-slate-700/60 pb-3">
        <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
