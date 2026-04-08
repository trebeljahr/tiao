"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { AuthResponse, PlayerIdentity } from "@shared";
import type { AuthDialogMode } from "@/components/Navbar";
import { authClient } from "@/lib/auth-client";
import { login as loginWithUsername, getPlayerIdentity } from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";

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
  authDialogForced: boolean;
  onOpenAuth: (mode: AuthDialogMode, options?: { forced?: boolean }) => void;
  handleLoginSubmit: () => Promise<void>;
  handleSignupSubmit: () => Promise<void>;
  handleForgotPassword: (email: string) => Promise<boolean>;
  handleOAuthSignIn: (provider: "github" | "google" | "discord") => Promise<void>;
  onLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AUTH_CACHE_KEY = "tiao:auth-cache";

function getCachedAuth(): AuthResponse | null {
  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthResponse;
  } catch {
    return null;
  }
}

function setCachedAuth(auth: AuthResponse | null) {
  try {
    if (auth) {
      sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(auth));
    } else {
      sessionStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    /* best-effort */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);

  // Track whether sessionStorage had cached auth at mount time.
  // Used to suppress the loading skeleton during bootstrap refresh.
  const hadCachedAuthRef = useRef(false);

  // Hydrate from sessionStorage cache on mount (client-only) to avoid
  // flash of skeleton when returning from external redirects like Stripe.
  const [cacheHydrated, setCacheHydrated] = useState(false);
  useEffect(() => {
    const cached = getCachedAuth();
    if (cached) {
      hadCachedAuthRef.current = true;
      setAuth(cached);
      setAuthLoading(false);
    }
    setCacheHydrated(true);
  }, []);

  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogForced, setAuthDialogForced] = useState(false);
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

  // Bootstrap: check better-auth session → if none, create anonymous guest.
  // If we have cached auth, skip showing the loading state (background refresh).
  useEffect(() => {
    if (!cacheHydrated) return;
    let cancelled = false;

    async function bootstrap() {
      // Only show loading spinner if we had no cached auth
      if (!hadCachedAuthRef.current) setAuthLoading(true);
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
            setCachedAuth({ player });
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
          setCachedAuth({ player });
          setAuth({ player });
        } else {
          // Fallback: build a minimal guest identity from the anonymous user
          const fallback = {
            player: {
              playerId: anonData.user.id,
              displayName: anonData.user.name,
              kind: "guest" as const,
            },
          };
          setCachedAuth(fallback);
          setAuth(fallback);
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
  }, [cacheHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrap setAuth to also persist to sessionStorage
  const updateAuth = useCallback((nextAuth: AuthResponse | null) => {
    setAuth(nextAuth);
    setCachedAuth(nextAuth);
  }, []);

  const applyAuth = useCallback(
    (nextAuth: AuthResponse) => {
      updateAuth(nextAuth);
      setAppError(null);
      setAuthDialogError(null);
    },
    [updateAuth],
  );

  const onOpenAuth = useCallback((mode: AuthDialogMode, options?: { forced?: boolean }) => {
    setAuthDialogMode(mode);
    setAuthDialogError(null);
    setAuthDialogForced(options?.forced ?? false);
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
      // On both success and failure, return the user to the page they
      // initiated OAuth from. On failure better-auth appends `?error=` to
      // errorCallbackURL and OAuthErrorHandler surfaces it as a toast, so the
      // user stays in context (e.g. inside a game) instead of being bounced
      // to a separate error page.
      const returnTo = window.location.origin + window.location.pathname;
      await authClient.signIn.social({
        provider,
        callbackURL: returnTo,
        errorCallbackURL: returnTo,
      });
    } catch (error) {
      toastError(readableError(error));
    }
  }, []);

  const onLogout = useCallback(async () => {
    // Order matters: we do the server-side signout + new-guest-session
    // dance FIRST while React state is still "logged in", then navigate
    // via a full page load, and only the fresh page sees the guest
    // session. If we flipped `auth` to null up front, any page that
    // requires an account (/friends, /games, /settings, etc.) would
    // flash its logged-out state (or redirect to the lobby) before the
    // navigation landed — a visible glitch. Full-page navigation to "/"
    // also naturally resets React tree + in-memory caches so there's no
    // need to clear them manually beforehand.
    try {
      await authClient.signOut();
      // Create a new anonymous guest session after logout so the reloaded
      // page boots straight into guest mode (no flash of the auth dialog).
      await authClient.signIn.anonymous();
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAppError(readableError(error));
      }
      return;
    }

    // Clear persistent per-browser flags that belong to the departing
    // account — the tutorial-seen flag is stored in localStorage so the
    // next guest shouldn't inherit it.
    if (typeof window !== "undefined") {
      localStorage.removeItem("tiao:knowsHowToPlay");
    }
    setCachedAuth(null);

    // Navigate to the lobby via a full page load — rebuilds the React
    // tree from scratch so protected pages never render in a half-
    // logged-out state.
    if (typeof window !== "undefined") {
      window.location.assign("/");
    }
  }, []);

  const value: AuthContextValue = {
    auth,
    authLoading,
    appError,
    authDialogOpen,
    authDialogForced,
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
