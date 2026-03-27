"use client";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import type { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LobbySocketProvider } from "@/lib/LobbySocketContext";
import { SocialNotificationsProvider } from "@/lib/SocialNotificationsContext";

function LoadingScreen() {
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

function AuthDialog() {
  const {
    authDialogOpen,
    authDialogMode,
    authBusy,
    loginEmail,
    loginPassword,
    signupDisplayName,
    signupEmail,
    signupPassword,
    signupConfirmPassword,
    setAuthDialogOpen,
    setAuthDialogMode,
    setAuthDialogError,
    setLoginEmail,
    setLoginPassword,
    setSignupDisplayName,
    setSignupEmail,
    setSignupPassword,
    setSignupConfirmPassword,
    handleLoginSubmit,
    handleSignupSubmit,
  } = useAuth();

  return (
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleLoginSubmit();
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <label
                htmlFor="login-email"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Username or Email
              </label>
              <Input
                id="login-email"
                name="identifier"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="name or name@example.com"
                autoComplete="username email"
                required
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="login-password"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Password
              </label>
              <Input
                id="login-password"
                name="password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={authBusy}
            >
              {authBusy ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        ) : null}

        {authDialogMode === "signup" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSignupSubmit();
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <label
                htmlFor="signup-display-name"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Username
              </label>
              <Input
                id="signup-display-name"
                name="name"
                value={signupDisplayName}
                onChange={(event) => setSignupDisplayName(event.target.value)}
                placeholder="Username"
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="signup-email"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Email (Optional)
              </label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="signup-password"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Password
              </label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                value={signupPassword}
                onChange={(event) => setSignupPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="signup-confirm-password"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Confirm Password
              </label>
              <Input
                id="signup-confirm-password"
                name="confirm-password"
                type="password"
                value={signupConfirmPassword}
                onChange={(event) => setSignupConfirmPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={authBusy}
            >
              {authBusy ? "Creating..." : "Create account"}
            </Button>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { auth, authLoading } = useAuth();

  if (authLoading) {
    return <LoadingScreen />;
  }

  return (
    <LobbySocketProvider auth={auth}>
      <SocialNotificationsProvider auth={auth}>
        <div className="min-h-screen bg-background text-foreground">
          <main className="min-h-screen">{children}</main>
          <AuthDialog />
          <Toaster
            richColors
            position="top-right"
            toastOptions={{
              style: {
                background: "#f5e6d0",
                color: "#4a3728",
                border: "1px solid #dbc6a2",
                boxShadow: "0 4px 16px rgba(74, 55, 40, 0.15)",
              },
              cancelButtonStyle: {
                background: "rgba(74, 55, 40, 0.1)",
                color: "#6e5b48",
              },
            }}
          />
        </div>
      </SocialNotificationsProvider>
    </LobbySocketProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    </ErrorBoundary>
  );
}
