import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  GitBranch,
  LayoutDashboard,
  LineChart,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import { ResizableChartProvider } from "./analytics/ResizableChartCard";
import { SettingsMenu } from "./SettingsMenu";

const menuNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clusters", label: "Clusters", icon: GitBranch },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles },
  { to: "/analysis", label: "Analysis", icon: LineChart },
];

const toolsNav = [{ to: "/assistant", label: "Assistant", icon: MessageCircle }];

const SIDEBAR_KEY = "intellirecommend.sidebar";

function readInitialSidebar(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    if (raw === "closed") return false;
    if (raw === "open") return true;
  } catch {
    /* ignore */
  }
  return true;
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(readInitialSidebar);
  const location = useLocation();
  const isFullWidthPage = location.pathname === "/assistant";

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "open" : "closed");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  const toggleSidebar = () => setSidebarOpen((v) => !v);
  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-accent/20 text-slate-100 shadow-sm shadow-accent/10"
        : "text-slate-400 hover:bg-surface-raised hover:text-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-surface text-slate-100">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <div className="flex min-h-screen">
        <aside
          aria-label="Primary navigation"
          className={`fixed inset-y-0 left-0 z-40 transform overflow-hidden border-r border-surface-border bg-surface-card transition-all duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            sidebarOpen
              ? "w-64 translate-x-0 lg:w-64"
              : "w-64 -translate-x-full lg:w-0 lg:border-r-0"
          }`}
        >
          <div className="flex h-full w-64 flex-col">
            <div className="flex items-center gap-2 border-b border-surface-border/70 px-3 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-indigo-600 font-display text-base font-bold text-white">
                I
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold tracking-tight">
                  IntelliRecommend
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  Decision intelligence
                </p>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Close sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-surface-raised hover:text-slate-100"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Menu
              </p>
              <ul className="space-y-0.5">
                {menuNav.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      onClick={closeOnMobile}
                      className={navItemClass}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>

              <p className="mb-1 mt-4 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Tools
              </p>
              <ul className="space-y-0.5">
                {toolsNav.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink to={to} onClick={closeOnMobile} className={navItemClass}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="border-t border-surface-border/70 px-2 py-2">
              <SettingsMenu variant="sidebar" />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-surface-border/80 bg-surface/90 px-3 backdrop-blur-md lg:px-6">
            {!sidebarOpen ? (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Open sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border bg-surface-card text-slate-400 transition hover:text-slate-100"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Close sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-surface-raised hover:text-slate-100 lg:hidden"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-indigo-600 font-display text-xs font-bold text-white">
                I
              </div>
              <p className="font-display text-sm font-semibold tracking-tight">IntelliRecommend</p>
            </div>
          </header>

          <main
            className={
              isFullWidthPage
                ? "flex w-full flex-1 flex-col px-4 py-4 lg:px-6"
                : "mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-6"
            }
          >
            <ResizableChartProvider>
              <Outlet />
            </ResizableChartProvider>
          </main>

          {isFullWidthPage ? null : (
          <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-xs text-slate-600 lg:px-6">
            <BarChart3 className="mx-auto mb-2 h-4 w-4 opacity-50" />
            Analytics and assisted insights use your organization&apos;s data. Assistant features require an API key
            configured by your administrator.
          </footer>
          )}
        </div>
      </div>
    </div>
  );
}
