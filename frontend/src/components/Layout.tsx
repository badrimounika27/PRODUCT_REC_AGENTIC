import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, GitBranch, LayoutDashboard, LineChart, Sparkles } from "lucide-react";
import { ChatAssistant } from "./ChatAssistant";
import { ResizableChartProvider } from "./analytics/ResizableChartCard";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clusters", label: "Clusters", icon: GitBranch },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles },
  { to: "/analysis", label: "Analysis", icon: LineChart },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-surface pb-24">
      <header className="sticky top-0 z-30 border-b border-surface-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-indigo-600 font-display text-lg font-bold text-white">
              R
            </div>
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">RECAI Intelligence</p>
              <p className="text-xs text-slate-500">Decision intelligence · Volume · Promotions</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-accent/20 text-white"
                      : "text-slate-400 hover:bg-surface-raised hover:text-slate-200"
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <ResizableChartProvider>
          <Outlet />
        </ResizableChartProvider>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-xs text-slate-600">
        <BarChart3 className="mx-auto mb-2 h-4 w-4 opacity-50" />
        Analytics and assisted insights use your organization&apos;s data. Assistant features require an API key
        configured by your administrator.
      </footer>

      <ChatAssistant />
    </div>
  );
}
