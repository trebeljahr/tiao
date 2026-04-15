"use client";

/**
 * The email/password/OAuth auth modal.
 *
 * Extracted out of providers.tsx so it can be dynamic-imported. This file
 * transitively pulls in:
 *
 *   - the Dialog, Input, PasswordInput, Button UI components
 *   - three react-icons/fa sub-path icons (GitHub, Google, Discord)
 *   - the getOAuthErrorMessage/toastError helpers
 *
 * None of that needs to be in the compile graph of every route — the
 * dialog only renders its body when the AuthDialogProvider state says
 * it's open, which is rare (user hitting a gated action), so we let
 * Turbopack pull it in as a separate chunk via `next/dynamic`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import type { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
// Barrel import is fine — Next.js's `optimizePackageImports` includes
// `react-icons/*` by default and rewrites this into per-icon imports
// at compile time. No manual sub-path imports needed.
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

export function AuthDialog() {
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
                    htmlFor="signup-new-password"
                    className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                  >
                    New Password
                  </label>
                  <PasswordInput
                    key="signup-new-password"
                    id="signup-new-password"
                    name="new-password"
                    value={signupPassword}
                    onChange={(event) => setSignupPassword(event.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="new-password"
                    aria-label="New password"
                    data-lpignore="false"
                    data-1p-ignore="false"
                    minLength={8}
                    visible={signupPasswordVisible}
                    onVisibilityChange={setSignupPasswordVisible}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="signup-confirm-new-password"
                    className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                  >
                    Confirm New Password
                  </label>
                  <PasswordInput
                    key="signup-confirm-new-password"
                    id="signup-confirm-new-password"
                    name="confirm-new-password"
                    value={signupConfirmPassword}
                    onChange={(event) => setSignupConfirmPassword(event.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="new-password"
                    aria-label="Confirm new password"
                    data-lpignore="false"
                    data-1p-ignore="false"
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

// Default export so `next/dynamic` can import it with the default-interop pattern
export default AuthDialog;
