import { useEffect, useState } from "react";
import type { AuthResponse } from "@shared";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createGuest, getCurrentPlayer, loginWithEmail, signUpWithEmail } from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import {
  clearStoredAuth,
  getStoredAuth,
  persistAuth,
} from "@/lib/playerAuth";
import { HomePage } from "./pages/HomePage";
import { ProfilePage } from "./pages/ProfilePage";

const ANONYMOUS_NAME = "Anonymous";

export function App() {
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

  useEffect(() => {
    let cancelled = false;

    async function ensureGuestAuth() {
      const guestAuth = await createGuest(ANONYMOUS_NAME);
      if (cancelled) {
        return;
      }

      persistAuth(guestAuth);
      setAuth(guestAuth);
      setAppError(null);
    }

    async function bootstrapAuth() {
      setAuthLoading(true);
      setAppError(null);

      const storedAuth = getStoredAuth();
      if (storedAuth) {
        try {
          const response = await getCurrentPlayer(storedAuth.token);
          if (cancelled) {
            return;
          }

          const nextAuth = {
            token: storedAuth.token,
            player: response.player,
          };
          persistAuth(nextAuth);
          setAuth(nextAuth);
          setAuthLoading(false);
          return;
        } catch (error) {
          clearStoredAuth();
          if (cancelled) {
            return;
          }

          if (isNetworkError(error)) {
            toastError(error);
          } else {
            setAppError(readableError(error));
          }
        }
      }

      try {
        await ensureGuestAuth();
      } catch (error) {
        if (!cancelled) {
          if (isNetworkError(error)) {
            toastError(error);
          } else {
            setAppError(readableError(error));
          }
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

  function applyAuth(nextAuth: AuthResponse) {
    persistAuth(nextAuth);
    setAuth(nextAuth);
    setAppError(null);
    setAuthDialogError(null);
  }

  function openAuthDialog(mode: AuthDialogMode) {
    setAuthDialogMode(mode);
    setAuthDialogError(null);
    setAuthDialogOpen(true);
  }

  async function handleLoginSubmit() {
    setAuthBusy(true);
    setAuthDialogError(null);

    try {
      const nextAuth = await loginWithEmail(loginEmail, loginPassword);
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
  }

  async function handleSignupSubmit() {
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
  }

  async function handleLogout() {
    clearStoredAuth();
    setAuth(null);

    try {
      const guestAuth = await createGuest(ANONYMOUS_NAME);
      applyAuth(guestAuth);
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAppError(readableError(error));
      }
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <div className="rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#faf0da,#ecd4a7)] font-display text-4xl text-[#24160d] shadow-[0_18px_30px_-22px_rgba(36,22,13,0.85)]">
            跳
          </div>
          <p className="mt-4 font-display text-3xl">Opening Tiao</p>
          <p className="mt-2 text-sm text-muted-foreground">Preparing the board.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProfilePage
                auth={auth}
                onAuthChange={applyAuth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
        </Routes>
      </main>

      <Dialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        title={authDialogMode === "login" ? "Sign in" : "Create account"}
        description="Sign in or create an account to save your profile."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["login", "signup"] as AuthDialogMode[]).map((item) => (
              <Button
                key={item}
                type="button"
                variant={authDialogMode === item ? "default" : "outline"}
                onClick={() => {
                  setAuthDialogMode(item);
                  setAuthDialogError(null);
                }}
              >
                {item === "signup"
                  ? "Sign up"
                  : item === "login"
                  ? "Sign in"
                  : null}
              </Button>
            ))}
          </div>

          {authDialogMode === "login" ? (
            <div className="space-y-3">
              <Input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="Email"
              />
              <Input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Password"
              />
              <Button
                className="w-full"
                onClick={handleLoginSubmit}
                disabled={authBusy}
              >
                {authBusy ? "Signing in..." : "Sign in"}
              </Button>
            </div>
          ) : null}

          {authDialogMode === "signup" ? (
            <div className="space-y-3">
              <Input
                value={signupDisplayName}
                onChange={(event) => setSignupDisplayName(event.target.value)}
                placeholder="Display name"
              />
              <Input
                type="email"
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
                placeholder="Email"
              />
              <Input
                type="password"
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
                placeholder="Password"
              />
              <Button
                className="w-full"
                onClick={handleSignupSubmit}
                disabled={authBusy}
              >
                {authBusy ? "Creating..." : "Create account"}
              </Button>
            </div>
          ) : null}
        </div>
      </Dialog>

      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          style: {
            background: "rgba(54, 37, 21, 0.96)",
            color: "#fff7ec",
            border: "1px solid rgba(246, 228, 197, 0.2)",
          },
        }}
      />
    </div>
  );
}
