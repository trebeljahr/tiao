"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { AuthResponse } from "@shared";
import type { AuthDialogMode } from "@/components/Navbar";
import {
  createGuest,
  getCurrentPlayer,
  login,
  logoutPlayer,
  signUpWithEmail,
} from "@/lib/api";
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
  onOpenAuth: (mode: AuthDialogMode) => void;
  handleLoginSubmit: () => Promise<void>;
  handleSignupSubmit: () => Promise<void>;
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
    if (!appError) {
      return;
    }

    toastError(appError);
    setAppError(null);
  }, [appError]);

  useEffect(() => {
    if (!authDialogError) {
      return;
    }

    toastError(authDialogError);
    setAuthDialogError(null);
  }, [authDialogError]);

  // Bootstrap auth: getCurrentPlayer → createGuest fallback with retries
  useEffect(() => {
    let cancelled = false;

    async function ensureGuestAuth() {
      const guestAuth = await createGuest();
      if (cancelled) {
        return;
      }

      setAuth(guestAuth);
      setAppError(null);
    }

    async function bootstrapAuth(retries = 5, delayMs = 800) {
      setAuthLoading(true);
      setAppError(null);

      try {
        const response = await getCurrentPlayer();
        if (cancelled) {
          return;
        }

        setAuth({
          player: response.player,
        });
        setAuthLoading(false);
        return;
      } catch (error) {
        if (cancelled) {
          return;
        }
      }

      try {
        await ensureGuestAuth();
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isNetworkError(error) && retries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          if (!cancelled) {
            return bootstrapAuth(retries - 1, delayMs * 1.5);
          }
          return;
        }

        if (isNetworkError(error)) {
          toastError(error);
        } else {
          setAppError(readableError(error));
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    void bootstrapAuth();

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
      const nextAuth = await login(loginEmail, loginPassword);
      applyAuth(nextAuth);
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
      const nextAuth = await signUpWithEmail(
        signupEmail,
        signupPassword,
        signupDisplayName
      );
      applyAuth(nextAuth);
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
  }, [signupEmail, signupPassword, signupDisplayName, signupConfirmPassword, applyAuth]);

  const onLogout = useCallback(async () => {
    setAuth(null);

    const isInGame =
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/game/");

    try {
      await logoutPlayer();
      const guestAuth = await createGuest();
      applyAuth(guestAuth);

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
