import { MessageCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { postChat } from "../api";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Which cluster needs attention?",
  "What should I do next across the network?",
  "Which month is best for recommendations?",
  "Explain the forecast and main risks",
  "Where are the biggest upsell opportunities?",
];

export function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Ask about stores, clusters, forecasts, or recommendations. I use your pipeline data as context.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || loading) return;
      const next: Msg[] = [...msgs, { role: "user", content: t }];
      setMsgs(next);
      setInput("");
      setLoading(true);
      try {
        const apiMsgs = next.map((m) => ({ role: m.role, content: m.content }));
        const { reply } = await postChat(apiMsgs);
        setMsgs([...next, { role: "assistant", content: reply }]);
      } catch (e) {
        setMsgs([
          ...next,
          {
            role: "assistant",
            content: `Sorry — ${e instanceof Error ? e.message : "request failed"}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, msgs],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition hover:scale-105 hover:bg-accent-dim"
        aria-label="Open assistant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed bottom-6 right-6 z-50 flex h-[min(560px,calc(100vh-3rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <span className="font-display font-semibold">AI Assistant</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-surface-raised hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-accent text-white"
                    : "mr-auto border border-surface-border bg-surface-raised text-slate-200"
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading ? (
              <div className="mr-auto rounded-2xl border border-surface-border bg-surface-raised px-3 py-2 text-sm text-slate-400">
                Thinking…
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
          <div className="border-t border-surface-border px-3 py-2">
            <div className="mb-2 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-surface-border bg-surface/50 px-2 py-0.5 text-[11px] text-slate-400 hover:border-accent/50 hover:text-slate-200"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="flex-1 rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm outline-none ring-0 placeholder:text-slate-600 focus:border-accent"
              />
              <button
                type="submit"
                disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-dim disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
