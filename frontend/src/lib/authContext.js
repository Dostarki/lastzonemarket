import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { createAuthenticationAdapter } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8001";
const API = `${BACKEND_URL}/api`;

const AuthContext = createContext({
  user: null,
  token: null,
  status: "unauthenticated", // 'loading' | 'authenticated' | 'unauthenticated'
  loading: true,
  checkAuth: async () => {},
  loginWithWallet: async () => {},
  updateProfile: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("dz_auth_token") || null);
  const [status, setStatus] = useState("loading");
  const [loading, setLoading] = useState(true);

  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Load existing session
  const checkAuth = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem("dz_auth_token");
      const headers = storedToken ? { Authorization: `Bearer ${storedToken}` } : {};
      const res = await fetch(`${API}/auth/me`, {
        headers,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.account) {
          setUser(data.account);
          setStatus("authenticated");
          setLoading(false);
          return data.account;
        }
      }
      setUser(null);
      setStatus("unauthenticated");
    } catch (err) {
      console.warn("Auth check failed:", err);
      setUser(null);
      setStatus("unauthenticated");
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem("dz_auth_token");
      const headers = storedToken ? { Authorization: `Bearer ${storedToken}` } : {};
      await fetch(`${API}/auth/logout`, {
        method: "POST",
        headers,
        credentials: "include",
      });
    } catch (e) {
      console.warn("Logout error:", e);
    } finally {
      localStorage.removeItem("dz_auth_token");
      setToken(null);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const updateProfile = useCallback(async (nickname, skin = "soldier") => {
    const storedToken = localStorage.getItem("dz_auth_token");
    const headers = {
      "Content-Type": "application/json",
      ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
    };
    const res = await fetch(`${API}/auth/profile`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ nickname, skin }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Profile update failed");
    }
    const data = await res.json();
    setUser(data.account);
    return data.account;
  }, []);

  // RainbowKit Authentication Adapter
  const authAdapter = useMemo(() => {
    return createAuthenticationAdapter({
      getNonce: async () => {
        const domain = typeof window !== "undefined" ? window.location.host : "localhost:3000";
        const uri = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
        const res = await fetch(`${API}/auth/challenge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, chain_id: 4663, domain, uri }),
        });
        if (!res.ok) throw new Error("Could not retrieve authentication challenge");
        const data = await res.json();
        return data.nonce;
      },
      createMessage: ({ nonce, address, chainId }) => {
        const domain = typeof window !== "undefined" ? window.location.host : "localhost:3000";
        const uri = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
        return [
          `${domain} wants you to sign in with your Ethereum account:`,
          address,
          ``,
          `Sign in to LastZHood Westfall with your Robinhood Chain wallet.`,
          ``,
          `URI: ${uri}`,
          `Version: 1`,
          `Chain ID: ${chainId || 4663}`,
          `Nonce: ${nonce}`,
          `Issued At: ${new Date().toISOString()}`,
        ].join("\n");
      },
      verify: async ({ message, signature }) => {
        const verifyRes = await fetch(`${API}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            message,
            signature,
          }),
        });
        if (!verifyRes.ok) {
          const errData = await verifyRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Authentication verification failed");
        }
        const data = await verifyRes.json();
        const authToken = data.token || data.sessionToken;
        if (authToken) {
          localStorage.setItem("dz_auth_token", authToken);
          setToken(authToken);
        }
        setUser(data.account);
        setStatus("authenticated");
        return true;
      },
      signOut: async () => {
        await logout();
      },
    });
  }, [address, logout]);

  // Direct login flow for MetaMask & injected wallets
  const loginWithWallet = useCallback(async (customNickname = "") => {
    if (!address) {
      throw new Error("Wallet not connected. Connect your wallet first.");
    }
    const domain = typeof window !== "undefined" ? window.location.host : "localhost:3000";
    const uri = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

    // 1. Get challenge matching the current browser origin
    const chalRes = await fetch(`${API}/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chain_id: 4663, domain, uri }),
    });
    if (!chalRes.ok) {
      const errText = await chalRes.text().catch(() => "");
      console.error("Challenge error:", chalRes.status, errText);
      throw new Error("Could not retrieve authentication challenge from server");
    }
    const challenge = await chalRes.json();
    const signText = challenge.message || challenge.siwe_message;
    if (!signText) {
      throw new Error("Server challenge did not contain a signable SIWE message");
    }


    // 2. Trigger MetaMask signature popup
    const signature = await signMessageAsync({
      message: signText,
      account: address,
    });


    // 3. Verify signature on backend
    const verifyRes = await fetch(`${API}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        message: signText,
        signature,
        nickname: customNickname || undefined,
      }),
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}));
      throw new Error(err.detail || "Signature verification failed");
    }
    const authData = await verifyRes.json();
    const authToken = authData.token || authData.sessionToken;
    if (authToken) {
      localStorage.setItem("dz_auth_token", authToken);
      setToken(authToken);
    }
    setUser(authData.account);
    setStatus("authenticated");
    return authData.account;
  }, [address, signMessageAsync]);

  const value = useMemo(
    () => ({
      user,
      token,
      status,
      loading,
      authAdapter,
      checkAuth,
      loginWithWallet,
      updateProfile,
      logout,
    }),
    [user, token, status, loading, authAdapter, checkAuth, loginWithWallet, updateProfile, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
