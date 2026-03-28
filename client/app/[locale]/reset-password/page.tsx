"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <h1 className="font-display text-2xl">Invalid link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This password reset link is invalid or has expired.
          </p>
          <a
            href="/"
            className="mt-4 inline-block text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Go home
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <h1 className="font-display text-2xl">Password reset</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <a
            href="/"
            className="mt-4 inline-block text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
        <h1 className="font-display text-2xl">Set new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a new password for your account.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);

            if (password !== confirmPassword) {
              setError("Passwords do not match.");
              return;
            }

            if (password.length < 8) {
              setError("Password must be at least 8 characters.");
              return;
            }

            setBusy(true);
            try {
              const { error: resetError } = await authClient.resetPassword({
                newPassword: password,
                token,
              });

              if (resetError) {
                setError(resetError.message || "Failed to reset password.");
              } else {
                setDone(true);
              }
            } catch {
              setError("Something went wrong. Please try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1">
            <label
              htmlFor="new-password"
              className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
            >
              New Password
            </label>
            <PasswordInput
              id="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="confirm-new-password"
              className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
            >
              Confirm Password
            </label>
            <PasswordInput
              id="confirm-new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Resetting..." : "Reset password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
