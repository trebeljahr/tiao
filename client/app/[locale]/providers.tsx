"use client";

import "@/lib/dump";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster, toast } from "sonner";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import type { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { LobbySocketProvider } from "@/lib/LobbySocketContext";
import { SocialNotificationsProvider } from "@/lib/SocialNotificationsContext";
import { getOAuthErrorMessage } from "@/lib/oauthErrors";
import { FaGithub, FaGoogle, FaDiscord } from "react-icons/fa";

function OAuthButtons() {
  const { handleOAuthSignIn } = useAuth();

  return (
    <div className="space-y-2">
      <p className="text-center text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
        Or continue with
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => void handleOAuthSignIn("github")}
        >
          <FaGithub className="h-4 w-4" />
          GitHub
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => void handleOAuthSignIn("google")}
        >
          <FaGoogle className="h-4 w-4" />
          Google
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => void handleOAuthSignIn("discord")}
        >
          <FaDiscord className="h-4 w-4" />
          Discord
        </Button>
      </div>
    </div>
  );
}

function AuthDialog() {
  const {
    auth,
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
    handleForgotPassword,
  } = useAuth();

  const isGuest = !auth || auth.player.kind === "guest";

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const dialogTitle = forgotMode
    ? "Reset password"
    : authDialogMode === "login"
      ? "Sign in"
      : "Create account";

  return (
    <Dialog
      open={authDialogOpen}
      onOpenChange={(open) => {
        setAuthDialogOpen(open);
        if (!open) setForgotMode(false);
      }}
      closeable={!isGuest}
      title={dialogTitle}
      description={
        forgotMode
          ? "Enter your email to receive a password reset link."
          : "Sign in or create an account to save your profile."
      }
    >
      <div className="space-y-4">
        {forgotMode ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setForgotBusy(true);
              const ok = await handleForgotPassword(forgotEmail);
              setForgotBusy(false);
              if (ok) {
                toast.success("Reset link sent! Check your email.");
                setForgotMode(false);
              }
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <label
                htmlFor="forgot-email"
                className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
              >
                Email
              </label>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={forgotBusy}>
              {forgotBusy ? "Sending..." : "Send reset link"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setForgotMode(false)}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <>
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
                  {item === "signup" ? "Sign up" : item === "login" ? "Sign in" : null}
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
                  <PasswordInput
                    id="login-password"
                    name="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    required
                  />
                </div>
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setForgotEmail(loginEmail);
                    setForgotMode(true);
                  }}
                >
                  Forgot password?
                </button>
                <Button type="submit" className="w-full" disabled={authBusy}>
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
                    onChange={(event) =>
                      setSignupDisplayName(
                        event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                      )
                    }
                    placeholder="username"
                    autoComplete="name"
                    pattern="^[a-z0-9][a-z0-9_\-]*$"
                    minLength={3}
                    maxLength={32}
                    title="Lowercase letters, numbers, hyphens, and underscores only (3-32 chars)"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="signup-email"
                    className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                  >
                    Email
                  </label>
                  <Input
                    id="signup-email"
                    name="email"
                    type="email"
                    value={signupEmail}
                    onChange={(event) => setSignupEmail(event.target.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="signup-password"
                    className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                  >
                    Password
                  </label>
                  <PasswordInput
                    id="signup-password"
                    name="password"
                    value={signupPassword}
                    onChange={(event) => setSignupPassword(event.target.value)}
                    placeholder="••••••••••••"
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
                  <PasswordInput
                    id="signup-confirm-password"
                    name="confirm-password"
                    value={signupConfirmPassword}
                    onChange={(event) => setSignupConfirmPassword(event.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={authBusy}>
                  {authBusy ? "Creating..." : "Create account"}
                </Button>
              </form>
            ) : null}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-xs text-muted-foreground">or</span>
              </div>
            </div>

            <OAuthButtons />
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Redirects SSO users who haven't chosen a valid username to /onboarding.
 * Prevents navigation away from /onboarding while needsUsername is true.
 */
function UsernameOnboardingGuard({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const needsUsername = auth?.player?.kind === "account" && auth.player.needsUsername === true;
  const isOnboardingPage = pathname?.endsWith("/onboarding") ?? false;

  useEffect(() => {
    if (needsUsername && !isOnboardingPage) {
      router.replace("/onboarding");
    }
  }, [needsUsername, isOnboardingPage, router]);

  // While redirect is pending, show nothing to avoid flash
  if (needsUsername && !isOnboardingPage) {
    return null;
  }

  return <>{children}</>;
}

function OAuthErrorHandler() {
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  useEffect(() => {
    // ProfilePage handles its own ?error= params for account linking
    if (pathname?.endsWith("/settings")) return;

    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (!error) return;

    toast.error(getOAuthErrorMessage(error, tCommon));
    window.history.replaceState({}, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();

  return (
    <LobbySocketProvider auth={auth}>
      <SocialNotificationsProvider auth={auth}>
        <div className="min-h-screen bg-background text-foreground">
          <UsernameOnboardingGuard>
            <main className="min-h-screen">{children}</main>
          </UsernameOnboardingGuard>
          <AuthDialog />
          <OAuthErrorHandler />
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
                flexShrink: 0,
              },
              actionButtonStyle: {
                flexShrink: 0,
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
