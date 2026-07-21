import { Eye, EyeOff, Loader2, Lock, Sparkles, User } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

type Mode = "login" | "signup";

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as LocationState | null)?.from?.pathname ?? "/";

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const res = isSignup ? await signup(username, password) : await login(username, password);
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate(redirectTo, { replace: true });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setConfirm("");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 py-10 text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.25),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(129,140,248,0.2),transparent_55%)]"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-indigo-600 text-white shadow-lg shadow-accent/30">
            <Sparkles className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-slate-100">IntelliRecommend</h1>
          <p className="mt-2 text-sm text-slate-400">An AI-Powered Product Recommendation Platform</p>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 shadow-2xl shadow-black/20">
          <div className="mb-6 flex rounded-xl bg-surface-raised p-1">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                !isSignup
                  ? "bg-accent text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isSignup
                  ? "bg-accent text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
                Username
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-surface-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/40"
                  placeholder="e.g. jane_doe"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-surface-border bg-surface-raised py-2 pl-9 pr-10 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/40"
                  placeholder={isSignup ? "At least 6 characters" : "Enter your password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition hover:text-slate-300"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isSignup ? (
              <div>
                <label
                  htmlFor="confirm"
                  className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                  <input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-surface-border bg-surface-raised py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/40"
                    placeholder="Re-enter password"
                  />
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSignup ? "Create account" : "Log in"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-500">
            {isSignup ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="font-medium text-accent hover:underline"
                >
                  Log in
                </button>
              </>
            ) : (
              <>
                New here?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-medium text-accent hover:underline"
                >
                  Create an account
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Accounts are stored locally in your browser for this preview build.
        </p>
      </div>
    </div>
  );
}
