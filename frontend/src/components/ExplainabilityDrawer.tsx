import { ChevronDown, HelpCircle } from "lucide-react";
import { useState } from "react";

type Props = {
  title?: string;
  bullets: string[];
  defaultOpen?: boolean;
  compact?: boolean;
};

export function ExplainabilityDrawer({
  title = "Why?",
  bullets,
  defaultOpen = false,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  if (!bullets.length) return null;

  return (
    <div
      className={`rounded-xl border border-surface-border/80 bg-surface/50 ${
        compact ? "text-xs" : "text-sm"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-medium text-accent hover:bg-surface-raised/50"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 shrink-0 opacity-80" />
          {title}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul className="space-y-1.5 border-t border-surface-border px-3 py-2 text-slate-400">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-mint">▸</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
