import { Check, LogOut, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import type { Theme } from "../contexts/ThemeContext";

export function SettingsMenu() {
  const { theme, setTheme } = useTheme();
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function handleLogout() {
    logout();
    setOpen(false);
    navigate("/login", { replace: true });
  }

  function handleTheme(t: Theme) {
    setTheme(t);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        className={`flex h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-raised text-slate-400 transition hover:text-slate-100 hover:bg-surface-card ${
          open ? "text-slate-100 bg-surface-card" : ""
        }`}
      >
        <SettingsIcon className="h-4 w-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-xl shadow-black/20"
        >
          {user ? (
            <div className="border-b border-surface-border px-3 py-2">
              <p className="text-[11px] uppercase tracking-widest text-slate-500">Signed in as</p>
              <p className="truncate text-sm font-medium text-slate-100">{user.username}</p>
            </div>
          ) : null}

          <div className="px-3 pb-2 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Theme</p>
            <div className="flex gap-1 rounded-lg bg-surface-raised p-1">
              <ThemeButton active={theme === "light"} onClick={() => handleTheme("light")} icon={<Sun className="h-3.5 w-3.5" />} label="Light" />
              <ThemeButton active={theme === "dark"} onClick={() => handleTheme("dark")} icon={<Moon className="h-3.5 w-3.5" />} label="Dark" />
            </div>
          </div>

          <div className="border-t border-surface-border p-1">
            <button
              type="button"
              onClick={handleLogout}
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-surface-raised hover:text-slate-100"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
        active ? "bg-accent text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
      }`}
      aria-pressed={active}
    >
      {icon}
      {label}
      {active ? <Check className="ml-0.5 h-3 w-3" aria-hidden /> : null}
    </button>
  );
}
