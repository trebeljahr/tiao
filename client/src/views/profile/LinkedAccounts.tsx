import { useTranslations } from "next-intl";
import { useState } from "react";
import { FaApple, FaDiscord, FaGithub, FaGoogle } from "react-icons/fa";
import { toast } from "sonner";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PaperCard } from "@/components/ui/paper-card";
import { PasswordInput } from "@/components/ui/password-input";
import { setAccountPassword } from "@/lib/api";
import { getAuthClient } from "@/lib/auth-client";
import { type SocialProvider, useAppleSignInEnabled } from "@/lib/authProviders";
import { readableError, toastError } from "@/lib/errors";
import { unlinkProviderAccount } from "@/lib/unlinkProviderAccount";

export const SOCIAL_PROVIDERS = [
  { id: "github" as const, label: "GitHub", icon: FaGithub },
  { id: "google" as const, label: "Google", icon: FaGoogle },
  { id: "discord" as const, label: "Discord", icon: FaDiscord },
  { id: "apple" as const, label: "Apple", icon: FaApple },
];

type LinkedAccountsProps = {
  providers: string[];
  onProvidersChange: () => void;
  currentEmail: string;
  currentDisplayName: string;
};

export function LinkedAccounts({
  providers,
  onProvidersChange,
  currentEmail,
  currentDisplayName,
}: LinkedAccountsProps) {
  const t = useTranslations("profile");
  const [busy, setBusy] = useState<string | null>(null);
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [setPasswordEmail, setSetPasswordEmail] = useState("");
  const [setPasswordUsername, setSetPasswordUsername] = useState("");
  const [newPassword, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPasswordValue] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const appleEnabled = useAppleSignInEnabled();
  const linkableProviders = SOCIAL_PROVIDERS.filter(
    (p) => !providers.includes(p.id) && (p.id !== "apple" || appleEnabled),
  );
  const linkedProviders = providers.filter((p) => p !== "credential");
  const unlinkableProviders = providers.length > 1;
  const hasCredential = providers.includes("credential");

  async function handleLink(provider: SocialProvider) {
    setBusy(provider);
    try {
      const settingsURL = window.location.origin + "/settings";
      // Stash the origin path so the global OAuthErrorHandler can bounce the
      // user back here even when better-auth falls back to its global error
      // URL (e.g. on state-mismatch / `please_restart_the_process`, which
      // redirects to FRONTEND_URL `/` before `errorCallbackURL` is consulted).
      try {
        // Store the fully-qualified pathname (incl. locale prefix) so the
        // error handler can bounce back to e.g. /en/settings, not bare
        // /settings which would route through the default locale.
        sessionStorage.setItem("oauthLinkReturnPath", window.location.pathname);
      } catch {
        // sessionStorage unavailable (private mode, etc.) — ignore
      }
      const authClient = await getAuthClient();
      const { error } = await authClient.linkSocial({
        provider,
        callbackURL: settingsURL,
        errorCallbackURL: settingsURL,
      });
      if (error) {
        toastError(readableError(error));
        setBusy(null);
      }
      // On success we intentionally leave `busy` set so the button keeps
      // showing "Linking…" until the OAuth redirect navigates away (or the
      // user cancels and comes back, at which point a remount clears state).
    } catch (error) {
      toastError(readableError(error));
      setBusy(null);
    }
  }

  async function handleUnlink(providerId: string) {
    setBusy(providerId);
    try {
      const authClient = await getAuthClient();
      await unlinkProviderAccount(authClient, providerId);
      onProvidersChange();
    } catch (error) {
      toastError(readableError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleSetPassword() {
    setPasswordError(null);

    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t("passwordTooShort"));
      return;
    }

    setSavingPassword(true);
    try {
      await setAccountPassword({
        password: newPassword,
        email: setPasswordEmail || undefined,
        displayName: setPasswordUsername || undefined,
      });
      setSetPasswordOpen(false);
      setNewPasswordValue("");
      setConfirmPasswordValue("");
      setSetPasswordEmail("");
      setSetPasswordUsername("");
      toast.success(t("passwordSet"));
      onProvidersChange();
    } catch (error) {
      setPasswordError(readableError(error));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <AnimatedCard delay={0.1}>
        <PaperCard>
          <CardHeader>
            <CardTitle>{t("linkedAccounts")}</CardTitle>
            <CardDescription>{t("linkedAccountsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Password/credential provider */}
            {hasCredential && (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-2.5">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-[#4e3d2c]">
                  {t("passwordLogin")}
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                    {t("connected")}
                  </span>
                </span>
                {unlinkableProviders && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy === "credential"}
                    onClick={() => void handleUnlink("credential")}
                    className="text-xs text-[#9a8670] hover:text-red-600"
                  >
                    {busy === "credential" ? t("unlinking") : t("unlink")}
                  </Button>
                )}
              </div>
            )}

            {/* Currently linked SSO providers */}
            {linkedProviders.length > 0 && (
              <div className="space-y-2">
                {linkedProviders.map((providerId) => {
                  const meta = SOCIAL_PROVIDERS.find((p) => p.id === providerId);
                  const Icon = meta?.icon;
                  return (
                    <div
                      key={providerId}
                      className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-2.5"
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-[#4e3d2c]">
                        {Icon && <Icon className="h-4 w-4" />}
                        {meta?.label ?? providerId}
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          {t("connected")}
                        </span>
                      </span>
                      {unlinkableProviders && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy === providerId}
                          onClick={() => void handleUnlink(providerId)}
                          className="text-xs text-[#9a8670] hover:text-red-600"
                        >
                          {busy === providerId ? t("unlinking") : t("unlink")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Link new providers */}
            {(linkableProviders.length > 0 || !hasCredential) && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]">
                  {t("linkNewAccount")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!hasCredential && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPasswordError(null);
                        setSetPasswordEmail(currentEmail);
                        setSetPasswordUsername(currentDisplayName);
                        setNewPasswordValue("");
                        setConfirmPasswordValue("");
                        setSetPasswordOpen(true);
                      }}
                      className="gap-2"
                    >
                      {t("addPasswordLogin")}
                    </Button>
                  )}
                  {linkableProviders.map(({ id, label, icon: Icon }) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy === id}
                      onClick={() => void handleLink(id)}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {busy === id ? t("linking") : label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </PaperCard>
      </AnimatedCard>

      <Dialog
        open={setPasswordOpen}
        onOpenChange={setSetPasswordOpen}
        title={t("setPasswordTitle")}
        description={t("setPasswordDesc")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSetPassword();
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <label htmlFor="set-username" className="text-sm font-medium text-[#4e3d2c]">
              {t("username")}
            </label>
            <Input
              id="set-username"
              name="username"
              value={setPasswordUsername}
              onChange={(e) =>
                setSetPasswordUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
              }
              placeholder={t("usernamePlaceholder")}
              autoComplete="username"
              pattern="^[a-z0-9][a-z0-9_\-]*$"
              minLength={3}
              maxLength={32}
              title="Lowercase letters, numbers, hyphens, and underscores only (3-32 chars)"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="set-email" className="text-sm font-medium text-[#4e3d2c]">
              {t("email")}
            </label>
            <Input
              id="set-email"
              name="email"
              type="email"
              value={setPasswordEmail}
              onChange={(e) => setSetPasswordEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="set-new-password" className="text-sm font-medium text-[#4e3d2c]">
              {t("newPassword")}
            </label>
            <PasswordInput
              id="set-new-password"
              name="password"
              value={newPassword}
              onChange={(e) => setNewPasswordValue(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={8}
              visible={passwordVisible}
              onVisibilityChange={setPasswordVisible}
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="set-confirm-password" className="text-sm font-medium text-[#4e3d2c]">
              {t("confirmNewPassword")}
            </label>
            <PasswordInput
              id="set-confirm-password"
              name="password-confirm"
              value={confirmPassword}
              onChange={(e) => setConfirmPasswordValue(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={8}
              visible={passwordVisible}
              onVisibilityChange={setPasswordVisible}
              required
            />
          </div>

          {passwordError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {passwordError}
            </p>
          ) : null}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? t("linking") : t("setPassword")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSetPasswordOpen(false)}>
              {t("cancelLabel")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
