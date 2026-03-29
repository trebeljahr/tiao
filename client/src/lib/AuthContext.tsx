"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthResponse, PlayerIdentity } from "@shared";
import type { AuthDialogMode } from "@/components/Navbar";
import { authClient } from "@/lib/auth-client";
import { login as loginWithUsername, getPlayerIdentity } from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import { resetBoardTheme } from "@/lib/useBoardTheme";
import { resetActiveBadges } from "@/lib/useActiveBadge";

export interface AuthContextValue {
  auth: AuthResponse | null;
  authLoading: boolean;
  appError: string | null;
  authDialogOpen: boolean;
  authDialogMode: AuthDialogMode;
  authBusy: boolean;
  authDialogError: string | null;
  loginEmail: string;
  loginPassword: string;
  signupDisplayName: string;
  signupEmail: string;
  signupPassword: string;
  signupConfirmPassword: string;
  setAuth: (auth: AuthResponse | null) => void;
  setAuthDialogOpen: (open: boolean) => void;
  setAuthDialogMode: (mode: AuthDialogMode) => void;
  setAuthDialogError: (error: string | null) => void;
  setLoginEmail: (email: string) => void;
  setLoginPassword: (password: string) => void;
  setSignupDisplayName: (name: string) => void;
  setSignupEmail: (email: string) => void;
  setSignupPassword: (password: string) => void;
  setSignupConfirmPassword: (password: string) => void;
  applyAuth: (nextAuth: AuthResponse) => void;
  onOpenAuth: (mode: AuthDialogMode) => void;
  handleLoginSubmit: () => Promise<void>;
  handleSignupSubmit: () => Promise<void>;
  handleForgotPassword: (email: string) => Promise<boolean>;
  handleOAuthSignIn: (provider: "github" | "google" | "discord") => Promise<void>;
  onLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);

  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authDialogError, setAuthDialogError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupDisplayName, setSignupDisplayName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  useEffect(() => {
    if (!appError) return;
    toastError(appError);
    setAppError(null);
  }, [appError]);

  useEffect(() => {
    if (!authDialogError) return;
    toastError(authDialogError);
    setAuthDialogError(null);
  }, [authDialogError]);

  // Convert a better-auth session user to our PlayerIdentity format
  async function fetchPlayerIdentity(): Promise<PlayerIdentity | null> {
    try {
      const { player } = await getPlayerIdentity();
      return player;
    } catch {
      return null;
    }
  }

  // Bootstrap: check better-auth session → if none, create anonymous guest
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setAuthLoading(true);
      setAppError(null);

      try {
        // Check for an existing better-auth session
        const { data: session } = await authClient.getSession();
        if (cancelled) return;

        if (session?.user) {
          // Session exists — fetch enriched PlayerIdentity
          const player = await fetchPlayerIdentity();
          if (cancelled) return;

          if (player) {
            setAuth({ player });
            setAuthLoading(false);
            return;
          }
        }

        // No session — create anonymous guest
        const { data: anonData, error: anonError } = await authClient.signIn.anonymous();
        if (cancelled) return;

        if (anonError || !anonData) {
          throw new Error(anonError?.message || "Failed to create guest session");
        }

        // Fetch the enriched identity for the new anonymous user
        const player = await fetchPlayerIdentity();
        if (cancelled) return;

        if (player) {
          setAuth({ player });
        } else {
          // Fallback: build a minimal guest identity from the anonymous user
          setAuth({
            player: {
              playerId: anonData.user.id,
              displayName: anonData.user.name,
              kind: "guest",
            },
          });
        }
      } catch (error) {
        if (cancelled) return;

        if (isNetworkError(error)) {
          toastError(error);
        } else {
          setAppError(readableError(error));
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyAuth = useCallback((nextAuth: AuthResponse) => {
    setAuth(nextAuth);
    setAppError(null);
    setAuthDialogError(null);
  }, []);

  const onOpenAuth = useCallback((mode: AuthDialogMode) => {
    setAuthDialogMode(mode);
    setAuthDialogError(null);
    setAuthDialogOpen(true);
  }, []);

  const handleLoginSubmit = useCallback(async () => {
    setAuthBusy(true);
    setAuthDialogError(null);

    try {
      // Use our custom login endpoint (supports username or email)
      const result = await loginWithUsername(loginEmail, loginPassword);
      applyAuth(result);
      setAuthDialogOpen(false);
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAuthDialogError(readableError(error));
      }
    } finally {
      setAuthBusy(false);
    }
  }, [loginEmail, loginPassword, applyAuth]);

  const handleSignupSubmit = useCallback(async () => {
    if (signupPassword !== signupConfirmPassword) {
      setAuthDialogError("Passwords do not match.");
      return;
    }

    setAuthBusy(true);
    setAuthDialogError(null);

    try {
      const { data, error } = await authClient.signUp.email({
        email: signupEmail,
        password: signupPassword,
        name: signupDisplayName,
      } as any);

      if (error) {
        setAuthDialogError(error.message || "Signup failed.");
        return;
      }

      if (data?.user) {
        // Fetch enriched PlayerIdentity after signup
        const player = await fetchPlayerIdentity();
        if (player) {
          applyAuth({ player });
        } else {
          applyAuth({
            player: {
              playerId: data.user.id,
              displayName: data.user.name,
              kind: "account",
              email: data.user.email,
            },
          });
        }
        setAuthDialogOpen(false);
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAuthDialogError(readableError(error));
      }
    } finally {
      setAuthBusy(false);
    }
  }, [signupEmail, signupPassword, signupDisplayName, signupConfirmPassword, applyAuth]);

  const handleForgotPassword = useCallback(async (email: string): Promise<boolean> => {
    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (error) {
        toastError(error.message || "Failed to send reset email.");
        return false;
      }
      return true;
    } catch (error) {
      toastError(readableError(error));
      return false;
    }
  }, []);

  const handleOAuthSignIn = useCallback(async (provider: "github" | "google" | "discord") => {
    try {
      await authClient.signIn.social({ provider });
    } catch (error) {
      toastError(readableError(error));
    }
  }, []);

  const onLogout = useCallback(async () => {
    setAuth(null);
    resetBoardTheme();
    resetActiveBadges();

    const isInGame = typeof window !== "undefined" && /\/game\//.test(window.location.pathname);

    try {
      await authClient.signOut();

      // Create a new anonymous guest session after logout
      const { data: anonData } = await authClient.signIn.anonymous();
      if (anonData?.user) {
        const player = await fetchPlayerIdentity();
        if (player) {
          applyAuth({ player });
        } else {
          applyAuth({
            player: {
              playerId: anonData.user.id,
              displayName: anonData.user.name,
              kind: "guest",
            },
          });
        }
      }

      if (isInGame && typeof window !== "undefined") {
        window.location.assign("/");
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAppError(readableError(error));
      }
    }
  }, [applyAuth]);

  const value: AuthContextValue = {
    auth,
    authLoading,
    appError,
    authDialogOpen,
    authDialogMode,
    authBusy,
    authDialogError,
    loginEmail,
    loginPassword,
    signupDisplayName,
    signupEmail,
    signupPassword,
    signupConfirmPassword,
    setAuth,
    setAuthDialogOpen,
    setAuthDialogMode,
    setAuthDialogError,
    setLoginEmail,
    setLoginPassword,
    setSignupDisplayName,
    setSignupEmail,
    setSignupPassword,
    setSignupConfirmPassword,
    applyAuth,
    onOpenAuth,
    handleLoginSubmit,
    handleSignupSubmit,
    handleForgotPassword,
    handleOAuthSignIn,
    onLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
