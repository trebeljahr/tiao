"use client";

import "@/lib/dump";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster, toast } from "sonner";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { toastError } from "@/lib/errors";
import { getOAuthErrorMessage } from "@/lib/oauthErrors";
import type { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { LobbySocketProvider } from "@/lib/LobbySocketContext";
import { SocialNotificationsProvider } from "@/lib/SocialNotificationsContext";
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
    authDialogOpen,
    authDialogForced,
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

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [signupPasswordVisible, setSignupPasswordVisible] = useState(false);

  const dialogTitle = forgotMode
    ? "Reset password"
    : authDialogForced
      ? "Log in to join this custom game"
      : authDialogMode === "login"
        ? "Log in"
        : "Create account";

  const dialogDescription = forgotMode
    ? "Enter your email to receive a password reset link."
    : authDialogForced
      ? "Custom games are only open to registered players. Log in or create a free account to join."
      : "Log in or create an account to save your profile.";

  return (
    <Dialog
      open={authDialogOpen}
      onOpenChange={(open) => {
        setAuthDialogOpen(open);
        if (!open) setForgotMode(false);
      }}
      closeable={!authDialogForced}
      title={dialogTitle}
      description={dialogDescription}
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
              Back to log in
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
                  {item === "signup" ? "Sign up" : item === "login" ? "Log in" : null}
                </Button>
              ))}
            </div>

            {authDialogMode === "login" ? (
              <form
                id="tiao-login-form"
                name="login"
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
                    name="username"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="name or name@example.com"
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="none"
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
                  {authBusy ? "Logging in..." : "Log in"}
                </Button>
              </form>
            ) : null}

            {authDialogMode === "signup" ? (
              // Form-level hints for browser/extension password generators:
              // - id+name "signup" so Chrome/1Password classify this as a
              //   create-account form (not a login form).
              // - one autocomplete="username" field followed by an
              //   autocomplete="email" field, then exactly one
              //   autocomplete="new-password" field, then a separate
              //   autocomplete="new-password" confirm field with a distinct
              //   `name` ("password-confirm") so generators don't treat both
              //   as the same input and refuse to fill.
              <form
                id="tiao-signup-form"
                name="signup"
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
                    name="username"
                    value={signupDisplayName}
                    onChange={(event) =>
                      setSignupDisplayName(
                        event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                      )
                    }
                    placeholder="username"
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="none"
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
                    spellCheck={false}
                    autoCapitalize="none"
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
                    minLength={8}
                    visible={signupPasswordVisible}
                    onVisibilityChange={setSignupPasswordVisible}
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
                    name="password-confirm"
                    value={signupConfirmPassword}
                    onChange={(event) => setSignupConfirmPassword(event.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="new-password"
                    minLength={8}
                    visible={signupPasswordVisible}
                    onVisibilityChange={setSignupPasswordVisible}
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (!error) return;

    // Surface OAuth/link failures as a toast on whatever page the user
    // initiated the flow from (better-auth honors errorCallbackURL), so
    // they stay in context — e.g. inside a game modal or the settings
    // page — and can retry immediately instead of being bounced to a
    // dedicated error page.
    const errorDescription = params.get("error_description");
    toastError(errorDescription || getOAuthErrorMessage(error, tCommon));

    // Clean the URL so the toast doesn't re-fire on refresh. Preserve any
    // other query params that might be in play.
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
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
            closeButton
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
