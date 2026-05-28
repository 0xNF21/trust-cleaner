"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { AuthConnectModal } from "@/components/auth/AuthConnectModal";
import { useWallet } from "@/hooks/use-wallet";
import { clearClientAuthToken, clientAuthHeaders } from "@/lib/client-auth-token";

type AuthContextValue = {
  isAuthenticated: boolean;
  address: string | null;
  origin: "miniapp" | "standalone" | "unknown" | null;
  expiresAt: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  openLogin: () => void;
  closeLogin: () => void;
};

type SessionInfo = {
  isAuthenticated: boolean;
  address: string | null;
  origin: "miniapp" | "standalone" | "unknown" | null;
  expiresAt: string | null;
};

const EMPTY: SessionInfo = {
  isAuthenticated: false,
  address: null,
  origin: null,
  expiresAt: null,
};

const AuthContext = createContext<AuthContextValue>({
  ...EMPTY,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
  openLogin: () => {},
  closeLogin: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address: hostAddress, isMiniappHost } = useWallet();
  const [session, setSession] = useState<SessionInfo>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const openLogin = useCallback(() => setModalOpen(true), []);
  const closeLogin = useCallback(() => setModalOpen(false), []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: clientAuthHeaders(),
      });
      const data = await response.json();
      if (data?.authenticated) {
        setSession({
          isAuthenticated: true,
          address: typeof data.address === "string" ? data.address.toLowerCase() : null,
          origin: data.origin ?? null,
          expiresAt: data.expiresAt ?? null,
        });
      } else {
        clearClientAuthToken();
        setSession(EMPTY);
      }
    } catch (error) {
      console.error("[auth] session fetch failed:", error);
      setSession(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    if (!isMiniappHost) return;
    if (!session.isAuthenticated || !session.address || !hostAddress) return;
    if (session.address === hostAddress.toLowerCase()) return;

    void (async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: clientAuthHeaders(),
        });
      } catch {}
      clearClientAuthToken();
      setSession(EMPTY);
    })();
  }, [hostAddress, isMiniappHost, session.address, session.isAuthenticated]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: clientAuthHeaders(),
      });
    } catch (error) {
      console.error("[auth] logout failed:", error);
    } finally {
      clearClientAuthToken();
      setSession(EMPTY);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: session.isAuthenticated,
        address: session.address,
        origin: session.origin,
        expiresAt: session.expiresAt,
        loading,
        refresh,
        logout,
        openLogin,
        closeLogin,
      }}
    >
      {children}
      <AuthConnectModal open={modalOpen} onClose={closeLogin} />
    </AuthContext.Provider>
  );
}

export function useAuthSession() {
  return useContext(AuthContext);
}
