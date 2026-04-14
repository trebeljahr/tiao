"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

export function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const t = useTranslations("resetPassword");
  const { auth, onOpenAuth, onLogout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <Navbar
          auth={auth}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          onCloseNav={() => setNavOpen(false)}
          onOpenAuth={onOpenAuth}
          onLogout={onLogout}
        />
        <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <h1 className="font-display text-2xl">{t("invalidLink")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("invalidLinkDescription")}</p>
          <a
            href="/"
            className="mt-4 inline-block text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("goHome")}
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <Navbar
          auth={auth}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          onCloseNav={() => setNavOpen(false)}
          onOpenAuth={onOpenAuth}
          onLogout={onLogout}
        />
        <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <h1 className="font-display text-2xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("successDescription")}</p>
          <a
            href="/"
            className="mt-4 inline-block text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("goHome")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />
      <div className="w-full max-w-sm rounded-3xl border border-border/80 bg-card/95 px-8 py-7 shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
        <h1 className="font-display text-2xl">{t("setNewPassword")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("setNewPasswordDescription")}</p>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);

            if (password !== confirmPassword) {
              setError(t("passwordsDoNotMatch"));
              return;
            }

            if (password.length < 8) {
              setError(t("passwordTooShort"));
              return;
            }

            setBusy(true);
            try {
              const { error: resetError } = await authClient.resetPassword({
                newPassword: password,
                token,
              });

              if (resetError) {
                setError(resetError.message || t("resetFailed"));
              } else {
                setDone(true);
              }
            } catch {
              setError(t("somethingWentWrongRetry"));
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
              {t("newPassword")}
            </label>
            <PasswordInput
              id="new-password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={8}
              visible={passwordVisible}
              onVisibilityChange={setPasswordVisible}
              required
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="confirm-new-password"
              className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
            >
              {t("confirmPassword")}
            </label>
            <PasswordInput
              id="confirm-new-password"
              name="password-confirm"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={8}
              visible={passwordVisible}
              onVisibilityChange={setPasswordVisible}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("resetting") : t("resetButton")}
          </Button>
        </form>
      </div>
    </div>
  );
}
