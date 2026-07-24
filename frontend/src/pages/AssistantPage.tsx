import { Loader2, MessageCircle, Send, Sparkles, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postChat } from "../api";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Which cluster has the lowest confidence and why?",
  "Top 5 stores by predicted revenue uplift next month",
  "Compare Kids vs Men vs Women category performance",
  "Which recommendation source drives the most revenue?",
  "What 3 actions should I prioritize this week?",
  "List high-risk stores in the current forecast",
];

const INITIAL_ASSISTANT: Msg = {
  role: "assistant",
  content:
    "Hi! I'm your IntelliRecommend assistant. Ask about stores, clusters, forecasts, or recommendations — I'll use your pipeline data as context.",
};

export function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([INITIAL_ASSISTANT]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function reset() {
    setMsgs([INITIAL_ASSISTANT]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  const isEmpty = msgs.length <= 1;

  return (
    <div className="flex h-[calc(100vh-5rem)] w-full flex-col">
      <div className="flex items-start justify-between gap-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-indigo-600 text-white shadow-sm shadow-accent/20">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-100">
              Assistant
            </h1>
            <p className="text-xs text-slate-500">
              AI-powered insights over your recommendation & forecast pipeline.
            </p>
          </div>
        </div>
        {!isEmpty ? (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            New chat
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-surface-border bg-surface-card/40 p-4">
        {isEmpty ? (
          <div className="flex h-full w-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/20 to-indigo-500/10 text-accent">
              <Sparkles className="h-7 w-7" />
            </div>
            <p className="max-w-2xl text-sm text-slate-300">{INITIAL_ASSISTANT.content}</p>
            <p className="mt-6 mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Try asking
            </p>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-surface-border bg-surface-raised/40 px-3 py-2.5 text-left text-sm text-slate-300 transition hover:border-accent/40 hover:bg-surface-raised hover:text-slate-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4">
            {msgs.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}
            {loading ? (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-surface-border bg-surface-raised px-4 py-2.5 text-sm text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="pt-3">
        {!isEmpty ? (
          <div className="mb-2 flex w-full flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={loading}
                className="shrink-0 rounded-full border border-surface-border bg-surface-card px-3 py-1 text-xs text-slate-400 transition hover:border-accent/50 hover:text-slate-100 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <form onSubmit={handleSubmit}>
          <div className="flex w-full items-end gap-2 rounded-2xl border border-surface-border bg-surface-card p-2 shadow-sm">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about stores, clusters, forecasts, recommendations…"
              rows={1}
              className="max-h-40 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-500">
            Assistant uses your pipeline data as context · Press Enter to send, Shift + Enter for a new line.
          </p>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-surface-raised text-slate-300"
            : "bg-accent/20 text-accent"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      {isUser ? (
        <div className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-accent px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm shadow-accent/20">
          {msg.content}
        </div>
      ) : (
        <div className="inline-block max-w-[85%] break-words rounded-2xl border border-surface-border bg-surface-raised px-4 py-2.5 text-sm leading-relaxed text-slate-200">
          <MarkdownContent content={msg.content} />
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="assistant-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1 className="mb-2 mt-3 text-lg font-semibold text-slate-100 first:mt-0" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mb-2 mt-3 text-base font-semibold text-slate-100 first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mb-1.5 mt-3 text-sm font-semibold uppercase tracking-wide text-accent first:mt-0" {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h4 className="mb-1 mt-2 text-sm font-semibold text-slate-100 first:mt-0" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="my-1.5 leading-relaxed text-slate-200 first:mt-0 last:mb-0" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-slate-100" {...props} />
          ),
          em: ({ node, ...props }) => <em className="italic text-slate-300" {...props} />,
          ul: ({ node, ...props }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-slate-500" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-slate-500" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="pl-1 leading-relaxed text-slate-200" {...props} />
          ),
          a: ({ node, ...props }) => (
            <a
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          code: ({ inline, className, children, ...props }: any) =>
            inline ? (
              <code
                className="rounded bg-surface-card px-1.5 py-0.5 font-mono text-[0.85em] text-accent"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code
                className={`block overflow-x-auto rounded-lg border border-surface-border bg-surface-card px-3 py-2 font-mono text-xs text-slate-200 ${className ?? ""}`}
                {...props}
              >
                {children}
              </code>
            ),
          pre: ({ node, ...props }) => (
            <pre className="my-2 overflow-x-auto rounded-lg" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="my-2 border-l-2 border-accent/60 pl-3 italic text-slate-300"
              {...props}
            />
          ),
          hr: () => <hr className="my-3 border-surface-border" />,
          table: ({ node, ...props }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-surface-card" {...props} />,
          th: ({ node, ...props }) => (
            <th
              className="border border-surface-border px-2 py-1 text-left font-semibold text-slate-100"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-surface-border px-2 py-1 text-slate-200" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
