import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Client-side auth store (prototype).
 *
 * User accounts (username + SHA-256 password hash) are persisted in
 * localStorage so a signed-up account survives across page loads. The
 * *session* is intentionally NOT persisted — every full page load / browser
 * refresh / server restart re-lands on the login screen. Users only stay
 * signed in for the lifetime of the current in-memory JS runtime.
 */

interface StoredUser {
  username: string;
  passwordHash: string;
  createdAt: number;
}

interface AuthUser {
  username: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signup: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
}

const USERS_KEY = "intellirecommend.users";
const LEGACY_SESSION_KEY = "intellirecommend.session";

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function loadUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* noop */
    }
  }, []);

  const signup = useCallback(async (username: string, password: string) => {
    const uname = username.trim();
    if (!uname) return { ok: false as const, error: "Username is required." };
    if (uname.length < 3) return { ok: false as const, error: "Username must be at least 3 characters." };
    if (!password || password.length < 6) return { ok: false as const, error: "Password must be at least 6 characters." };

    const users = loadUsers();
    if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
      return { ok: false as const, error: "That username is already taken." };
    }
    const passwordHash = await hashPassword(password);
    users.push({ username: uname, passwordHash, createdAt: Date.now() });
    saveUsers(users);

    setUser({ username: uname });
    return { ok: true as const };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const uname = username.trim();
    if (!uname || !password) return { ok: false as const, error: "Enter username and password." };

    const users = loadUsers();
    const match = users.find((u) => u.username.toLowerCase() === uname.toLowerCase());
    if (!match) return { ok: false as const, error: "No account found with that username." };
    const passwordHash = await hashPassword(password);
    if (passwordHash !== match.passwordHash) return { ok: false as const, error: "Incorrect password." };

    setUser({ username: match.username });
    return { ok: true as const };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: !!user, loading: false, login, signup, logout }),
    [user, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
