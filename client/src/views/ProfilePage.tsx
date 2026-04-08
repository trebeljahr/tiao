"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FaGithub, FaGoogle, FaDiscord } from "react-icons/fa";
import { useAuth } from "@/lib/AuthContext";
import { authClient } from "@/lib/auth-client";
import { BackButton } from "@/components/BackButton";
import { PageLayout } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { AnimatedCard } from "@/components/ui/animated-card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getAccountProfile,
  type AccountProfile,
  updateAccountProfile,
  uploadAccountProfilePicture,
  deleteAccount,
} from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import { setAccountPassword, requestEmailChange } from "@/lib/api";
import { toast } from "sonner";
import { SkeletonBlock, SkeletonPage } from "@/components/ui/skeleton";
import { BadgeSelector } from "@/components/BadgeSelector";
import { useLocale, useTranslations } from "next-intl";

const PROFILE_PIC_SIZE = 512;
const PROFILE_PIC_QUALITY = 0.85;

function resizeImage(
  file: File,
  errorMessages: { failedToResize: string; failedToLoad: string },
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const size = Math.min(width, height);
      const sx = (width - size) / 2;
      const sy = (height - size) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = PROFILE_PIC_SIZE;
      canvas.height = PROFILE_PIC_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, size, size, 0, 0, PROFILE_PIC_SIZE, PROFILE_PIC_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(errorMessages.failedToResize));
            return;
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        PROFILE_PIC_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(errorMessages.failedToLoad));
    };

    img.src = url;
  });
}

const SOCIAL_PROVIDERS = [
  { id: "github" as const, label: "GitHub", icon: FaGithub },
  { id: "google" as const, label: "Google", icon: FaGoogle },
  { id: "discord" as const, label: "Discord", icon: FaDiscord },
];

function LinkedAccounts({
  providers,
  onProvidersChange,
  currentEmail,
  currentDisplayName,
}: {
  providers: string[];
  onProvidersChange: () => void;
  currentEmail: string;
  currentDisplayName: string;
}) {
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

  const linkedProviders = providers.filter((p) => p !== "credential");
  const unlinkableProviders = providers.length > 1;
  const hasCredential = providers.includes("credential");

  async function handleLink(provider: "github" | "google" | "discord") {
    setBusy(provider);
    try {
      const settingsURL = window.location.origin + "/settings";
      const { error } = await authClient.linkSocial({
        provider,
        callbackURL: settingsURL,
        errorCallbackURL: settingsURL,
      });
      if (error) {
        toastError(readableError(error));
      }
    } catch (error) {
      toastError(readableError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlink(providerId: string) {
    setBusy(providerId);
    try {
      const { error } = await authClient.unlinkAccount({ providerId });
      if (error) {
        toastError(readableError(error));
      } else {
        onProvidersChange();
      }
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
            {(SOCIAL_PROVIDERS.some((p) => !providers.includes(p.id)) || !hasCredential) && (
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
                  {SOCIAL_PROVIDERS.filter((p) => !providers.includes(p.id)).map(
                    ({ id, label, icon: Icon }) => (
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
                    ),
                  )}
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

function formatTimestamp(value: string | undefined, justNowLabel: string, locale?: string) {
  if (!value) {
    return justNowLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProfilePage() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tError = useTranslations("error");
  const locale = useLocale();
  const { auth, authLoading, applyAuth: onAuthChange, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  // Username change modal
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameModalPassword, setUsernameModalPassword] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  // Email change modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [newEmailValue, setNewEmailValue] = useState("");
  const [emailModalPassword, setEmailModalPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [emailChangeSent, setEmailChangeSent] = useState(false);
  // Bio auto-save state
  const [bioSaving, setBioSaving] = useState(false);
  const [bioSaved, setBioSaved] = useState(false);
  const [, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copyLinkFeedback, setCopyLinkFeedback] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (auth?.player.kind !== "account") {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setPageError(null);

      try {
        const response = await getAccountProfile();
        if (cancelled) {
          return;
        }

        setProfile(response.profile);
        setDisplayName(response.profile.displayName);
        setBio(response.profile.bio ?? "");
        setEmail(response.profile.email ?? "");
      } catch (error) {
        if (!cancelled) {
          if (isNetworkError(error)) {
            toastError(error);
          } else {
            setPageError(readableError(error));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [auth]);

  // Show toast for ?emailChange=success|expired|invalid|error from the email
  // change flow. OAuth ?error= params are handled globally by OAuthErrorHandler
  // in providers.tsx.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailChange = params.get("emailChange");
    if (!emailChange) return;

    if (emailChange === "success") {
      toast.success(t("emailChangeSuccess"));
      // Refresh the profile so the new email shows up
      void getAccountProfile().then((response) => {
        setProfile(response.profile);
        setEmail(response.profile.email || "");
      });
    } else if (emailChange === "expired") {
      toastError(t("emailChangeExpired"));
    } else if (emailChange === "invalid") {
      toastError(t("emailChangeInvalid"));
    } else if (emailChange === "error") {
      toastError(t("emailChangeError"));
    }

    // Clean the URL so the message doesn't re-appear on refresh. Preserve
    // other params (OAuthErrorHandler cleans ?error= on its own pass).
    const url = new URL(window.location.href);
    url.searchParams.delete("emailChange");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const providers = profile?.providers ?? [];
  const hasCredentialProvider = providers.includes("credential");
  const hasOAuthProvider = providers.some((p) => p !== "credential");
  const oauthProviderId = providers.find((p) => p !== "credential");
  const oauthProviderLabel =
    SOCIAL_PROVIDERS.find((p) => p.id === oauthProviderId)?.label ?? oauthProviderId ?? "OAuth";

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!successMessage) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!pageError) {
      return;
    }

    toastError(pageError);
    setPageError(null);
  }, [pageError]);

  async function handleChangeUsername() {
    setUsernameError(null);

    const trimmed = newUsername.trim().toLowerCase();
    if (trimmed.length < 3 || trimmed.length > 32) {
      setUsernameError(t("usernameLengthError"));
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
      setUsernameError(t("usernameFormatError"));
      return;
    }
    if (hasCredentialProvider && !usernameModalPassword) {
      setUsernameError(t("currentPasswordRequired"));
      return;
    }

    setSavingUsername(true);
    try {
      const response = await updateAccountProfile({
        displayName: trimmed,
        currentPassword: hasCredentialProvider ? usernameModalPassword : undefined,
      });
      onAuthChange(response.auth);
      setProfile(response.profile);
      setDisplayName(response.profile.displayName);
      setUsernameModalOpen(false);
      setNewUsername("");
      setUsernameModalPassword("");
      toast.success(t("usernameUpdated"));
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setUsernameError(readableError(error));
      }
    } finally {
      setSavingUsername(false);
    }
  }

  async function handleRequestEmailChange() {
    setEmailError(null);

    const trimmed = newEmailValue.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setEmailError(t("emailInvalid"));
      return;
    }
    if (!emailModalPassword) {
      setEmailError(t("currentPasswordRequired"));
      return;
    }

    setRequestingEmailChange(true);
    try {
      await requestEmailChange({
        newEmail: trimmed,
        currentPassword: emailModalPassword,
      });
      setEmailChangeSent(true);
      setEmailModalPassword("");
      toast.success(t("emailVerificationSent", { email: trimmed }));
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setEmailError(readableError(error));
      }
    } finally {
      setRequestingEmailChange(false);
    }
  }

  // Optimistic bio auto-save: update locally on every keystroke,
  // but only POST to the server after the user has been idle for 1500ms.
  // Also flush immediately on blur so leaving the field never loses pending changes.
  const bioSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedBioRef = useRef<string>("");
  const inFlightBioRef = useRef<string | null>(null);

  // Track the current saved bio so flushBio can compare against it without stale closures.
  useEffect(() => {
    lastSavedBioRef.current = profile?.bio ?? "";
  }, [profile?.bio]);

  const flushBio = useCallback(
    async (value: string) => {
      if (!auth || auth.player.kind !== "account") return;
      // Skip if nothing changed since the last save, or this exact value is already in flight.
      if (value === lastSavedBioRef.current) return;
      if (value === inFlightBioRef.current) return;

      if (bioSaveTimerRef.current) {
        clearTimeout(bioSaveTimerRef.current);
        bioSaveTimerRef.current = null;
      }

      inFlightBioRef.current = value;
      setBioSaving(true);
      try {
        const response = await updateAccountProfile({ bio: value });
        onAuthChange(response.auth);
        setProfile(response.profile);
        lastSavedBioRef.current = response.profile.bio ?? "";
        setBioSaved(true);
        setTimeout(() => setBioSaved(false), 2000);
      } catch (error) {
        if (isNetworkError(error)) {
          toastError(error);
        } else {
          setPageError(readableError(error));
        }
      } finally {
        inFlightBioRef.current = null;
        setBioSaving(false);
      }
    },
    [auth, onAuthChange],
  );

  // Schedule a debounced save whenever bio changes (after the initial load).
  useEffect(() => {
    if (loading) return;
    if (bio === lastSavedBioRef.current) return;

    if (bioSaveTimerRef.current) clearTimeout(bioSaveTimerRef.current);
    bioSaveTimerRef.current = setTimeout(() => {
      void flushBio(bio);
    }, 1500);

    return () => {
      if (bioSaveTimerRef.current) clearTimeout(bioSaveTimerRef.current);
    };
  }, [bio, loading, flushBio]);

  // Cleanup on unmount: flush any pending changes synchronously is not possible,
  // but we can at least cancel the timer so we don't try to call setState after unmount.
  useEffect(() => {
    return () => {
      if (bioSaveTimerRef.current) clearTimeout(bioSaveTimerRef.current);
    };
  }, []);

  async function handleChangePassword() {
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
      const response = await updateAccountProfile({
        currentPassword,
        password: newPassword,
      });
      onAuthChange(response.auth);
      setProfile(response.profile);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordModalOpen(false);
      setSuccessMessage(t("passwordChanged"));
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setPasswordError(readableError(error));
      }
    } finally {
      setSavingPassword(false);
    }
  }

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toastError(tError("selectImage"));
        return;
      }
      if (!auth || auth.player.kind !== "account") return;

      setUploading(true);
      setPageError(null);

      try {
        const resized = await resizeImage(file, {
          failedToResize: t("failedToResizeImage"),
          failedToLoad: t("failedToLoadImage"),
        });
        const objectUrl = URL.createObjectURL(resized);
        setPreviewUrl(objectUrl);
        setSelectedFile(resized);

        const response = await uploadAccountProfilePicture(resized);
        onAuthChange(response.auth);
        setProfile(response.profile);
        setSelectedFile(null);
        setSuccessMessage(t("profilePictureUpdated"));
      } catch (error) {
        if (isNetworkError(error)) {
          toastError(error);
        } else {
          setPageError(readableError(error));
        }
      } finally {
        setUploading(false);
      }
    },
    [auth, onAuthChange, t, tError],
  );

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void handleImageFile(file);
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleImageFile]);

  const profileImage = previewUrl || profile?.profilePicture || auth?.player.profilePicture;

  if (authLoading) {
    return <SkeletonPage />;
  }

  return (
    <PageLayout>
      <BackButton />

      {auth?.player.kind !== "account" ? (
        <AnimatedCard delay={0}>
          <PaperCard>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                {t("guestNotice")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => onOpenAuth("signup")}>{t("createAccount")}</Button>
                <Button variant="outline" onClick={() => onOpenAuth("login")}>
                  {tCommon("signIn")}
                </Button>
              </div>
            </CardContent>
          </PaperCard>
        </AnimatedCard>
      ) : null}

      {auth?.player.kind === "account" ? (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <AnimatedCard delay={0}>
            <PaperCard>
              <CardHeader>
                <CardTitle>{t("picture")}</CardTitle>
                <CardDescription>{t("pictureDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  ref={dropZoneRef}
                  role="button"
                  tabIndex={0}
                  className={`group relative mx-auto flex h-56 w-56 cursor-pointer items-center justify-center overflow-hidden rounded-4xl border-2 border-dashed transition-all ${
                    dragging
                      ? "border-[#b08440] bg-[linear-gradient(180deg,#fff6e2,#f0d9a8)] scale-[1.03] shadow-[0_24px_60px_-30px_rgba(58,35,16,0.7)]"
                      : "border-[#d4bd94] bg-[linear-gradient(180deg,#fbf2de,#ead5aa)] shadow-[0_24px_60px_-38px_rgba(58,35,16,0.6)] hover:border-[#c4a46e] hover:shadow-[0_24px_60px_-30px_rgba(58,35,16,0.7)]"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (
                      dropZoneRef.current &&
                      !dropZoneRef.current.contains(e.relatedTarget as Node)
                    ) {
                      setDragging(false);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) void handleImageFile(file);
                  }}
                >
                  {uploading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(251,242,222,0.85)]">
                      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#d4bd94] border-t-[#8b6914]" />
                    </div>
                  )}
                  {profileImage ? (
                    <>
                      <img
                        src={profileImage}
                        alt={displayName || auth.player.displayName}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.4)] opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="text-sm font-medium text-white">{t("changePhoto")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-4 text-center">
                      <span className="font-display text-5xl text-[#2d2016]/30">
                        {(displayName || auth.player.displayName).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-xs text-[#8b7659]">
                        {dragging ? t("dropImage") : t("clickDragPaste")}
                      </span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImageFile(file);
                      e.target.value = "";
                    }}
                  />
                </div>

                <p className="text-center text-xs text-[#8b7659]">{t("pictureHint")}</p>
              </CardContent>
            </PaperCard>
          </AnimatedCard>

          <AnimatedCard delay={0.05}>
            <PaperCard>
              <CardHeader>
                <CardTitle>{t("basicInfo")}</CardTitle>
                <CardDescription>{t("basicInfoDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="animate-pulse space-y-4">
                    {/* Username skeleton */}
                    <div className="grid gap-2">
                      <SkeletonBlock className="h-4 w-20" />
                      <SkeletonBlock className="h-9 w-full rounded-xl" />
                      <SkeletonBlock className="h-3 w-48 bg-[#ede3d2]" />
                    </div>
                    {/* Bio skeleton */}
                    <div className="grid gap-2">
                      <SkeletonBlock className="h-4 w-10" />
                      <SkeletonBlock className="h-20 w-full rounded-xl" />
                      <SkeletonBlock className="h-3 w-24 bg-[#ede3d2]" />
                    </div>
                    {/* Email skeleton */}
                    <div className="grid gap-2">
                      <SkeletonBlock className="h-4 w-32" />
                      <SkeletonBlock className="h-9 w-full rounded-xl" />
                    </div>
                    {/* Rating info skeleton */}
                    <div className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3">
                      <div className="flex items-baseline justify-between">
                        <SkeletonBlock className="h-4 w-14" />
                        <SkeletonBlock className="h-6 w-12" />
                      </div>
                      <SkeletonBlock className="mt-2 h-3 w-20 bg-[#ede3d2]" />
                    </div>
                    {/* Timestamps skeleton */}
                    <div className="space-y-2 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3">
                      <SkeletonBlock className="h-4 w-56" />
                      <SkeletonBlock className="h-4 w-56" />
                    </div>
                    {/* Buttons skeleton */}
                    <div className="flex flex-wrap gap-3">
                      <SkeletonBlock className="h-9 w-32 rounded-xl" />
                      <SkeletonBlock className="h-9 w-36 rounded-xl" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Username row */}
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fffdf8] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium uppercase tracking-wide text-[#8d7760]">
                          {t("username")}
                        </div>
                        <div className="truncate text-sm font-medium text-[#2b1e14]">
                          {displayName}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("changeUsernameTitle")}
                        onClick={() => {
                          setUsernameError(null);
                          setNewUsername(displayName);
                          setUsernameModalPassword("");
                          setUsernameModalOpen(true);
                        }}
                      >
                        {tCommon("edit")}
                      </Button>
                    </div>

                    {/* Email row */}
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fffdf8] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium uppercase tracking-wide text-[#8d7760]">
                          {t("email")}
                        </div>
                        <div className="truncate text-sm font-medium text-[#2b1e14]">
                          {email || <span className="text-[#8d7760]">{t("noEmailSet")}</span>}
                        </div>
                        {hasOAuthProvider && !hasCredentialProvider && (
                          <p className="mt-1 text-xs text-[#8d7760]">
                            {t("emailManagedByProvider", { provider: oauthProviderLabel })}
                          </p>
                        )}
                      </div>
                      {hasCredentialProvider && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t("changeEmailTitle")}
                          onClick={() => {
                            setEmailError(null);
                            setEmailChangeSent(false);
                            setNewEmailValue(email);
                            setEmailModalPassword("");
                            setEmailModalOpen(true);
                          }}
                        >
                          {tCommon("edit")}
                        </Button>
                      )}
                    </div>

                    {/* Password row */}
                    {hasCredentialProvider && (
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fffdf8] px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium uppercase tracking-wide text-[#8d7760]">
                            {t("password")}
                          </div>
                          <div className="text-sm font-medium text-[#2b1e14]">••••••••••••</div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t("changePassword")}
                          onClick={() => {
                            setPasswordError(null);
                            setCurrentPassword("");
                            setNewPassword("");
                            setConfirmPassword("");
                            setPasswordModalOpen(true);
                          }}
                        >
                          {tCommon("edit")}
                        </Button>
                      </div>
                    )}

                    {/* Bio (auto-saving textarea) */}
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <label htmlFor="profile-bio" className="text-sm font-medium text-[#4e3d2c]">
                          {t("bio")}
                        </label>
                        {bioSaving && (
                          <span className="text-xs text-[#8d7760]">{tCommon("saving")}…</span>
                        )}
                        {bioSaved && !bioSaving && (
                          <span className="text-xs text-emerald-700">✓ {tCommon("saved")}</span>
                        )}
                      </div>
                      <textarea
                        id="profile-bio"
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, 500))}
                        onBlur={() => void flushBio(bio)}
                        placeholder={t("bioPlaceholder")}
                        rows={3}
                        maxLength={500}
                        className="flex w-full rounded-xl border border-[#dcc7a3] bg-[#fffdf8] px-3 py-2 text-sm text-[#2b1e14] shadow-xs placeholder:text-[#b8a68e] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#b08440] disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <p className="text-xs text-[#8d7760]">
                        {t("bioHint", { count: bio.length, max: 500 })}
                      </p>
                    </div>

                    {/* Rating info */}
                    <div className="grid gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                      <div className="flex items-baseline justify-between">
                        <span className="font-medium text-[#4e3d2c]">{t("rating")}</span>
                        <span className="font-display text-lg font-bold text-[#2b1e14]">
                          {profile?.rating ?? 1500}
                        </span>
                      </div>
                      {(profile?.gamesPlayed ?? 0) > 0 && profile?.ratingPercentile != null && (
                        <p className="text-xs text-[#8d7760]">
                          {t("ratingPercentile", { percentile: 100 - profile.ratingPercentile })}
                        </p>
                      )}
                      {(profile?.gamesPlayed ?? 0) === 0 && (
                        <p className="text-xs text-[#8d7760]">{t("ratingProvisional")}</p>
                      )}
                    </div>

                    {/* Timestamps */}
                    <div className="grid gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                      <p>
                        {t("created", {
                          date: formatTimestamp(profile?.createdAt, t("justNow"), locale),
                        })}
                      </p>
                      <p>
                        {t("updated", {
                          date: formatTimestamp(profile?.updatedAt, t("justNow"), locale),
                        })}
                      </p>
                    </div>

                    {/* Copy profile link */}
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const url = `${window.location.origin}/profile/${encodeURIComponent(displayName)}`;
                            await navigator.clipboard.writeText(url);
                            toast.success(t("copiedProfileLink"));
                            setCopyLinkFeedback(true);
                            setTimeout(() => setCopyLinkFeedback(false), 2000);
                          } catch {
                            toast.error(tCommon("failedToCopy"));
                          }
                        }}
                      >
                        {copyLinkFeedback ? tCommon("copied") : t("copyProfileLink")}
                      </Button>
                    </div>
                  </div>
                )}

                {successMessage ? (
                  <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {successMessage}
                  </p>
                ) : null}
              </CardContent>
            </PaperCard>
          </AnimatedCard>

          <LinkedAccounts
            providers={providers}
            currentEmail={email}
            currentDisplayName={displayName}
            onProvidersChange={() => {
              void (async () => {
                try {
                  const response = await getAccountProfile();
                  setProfile(response.profile);
                } catch (error) {
                  toastError(readableError(error));
                }
              })();
            }}
          />

          <BadgeSelector auth={auth} onAuthChange={onAuthChange} delay={0.15} />

          <Card className="border-red-300 bg-red-50/50">
            <CardHeader>
              <CardTitle className="text-red-700">{t("deleteAccount")}</CardTitle>
              <CardDescription className="text-red-600/80">
                {t("deleteAccountDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800"
                onClick={() => {
                  setDeleteConfirmName("");
                  setDeleteModalOpen(true);
                }}
              >
                {t("deleteAccount")}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
      <Dialog
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        title={t("deleteAccount")}
        description={t("deleteAccountConfirm")}
      >
        <div className="space-y-4">
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {t("deleteAccountWarning")}
          </p>

          <div className="grid gap-2">
            <label htmlFor="delete-confirm-name" className="text-sm font-medium text-[#4e3d2c]">
              {t("typeNameToConfirm", { name: profile?.displayName ?? "" })}
            </label>
            <Input
              id="delete-confirm-name"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={profile?.displayName ?? ""}
              autoComplete="off"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800"
              disabled={deleting || deleteConfirmName !== profile?.displayName}
              onClick={async () => {
                setDeleting(true);
                try {
                  await deleteAccount(deleteConfirmName);
                  setDeleteModalOpen(false);
                  await onLogout();
                  router.push("/");
                } catch (error) {
                  toastError(readableError(error));
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? t("deleting") : t("deleteMyAccount")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeleteModalOpen(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
        title={t("changePasswordTitle")}
        description={t("changePasswordDesc")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleChangePassword();
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <label htmlFor="current-password" className="text-sm font-medium text-[#4e3d2c]">
              {t("currentPassword")}
            </label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="new-password" className="text-sm font-medium text-[#4e3d2c]">
              {t("newPassword")}
            </label>
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="confirm-password" className="text-sm font-medium text-[#4e3d2c]">
              {t("confirmNewPassword")}
            </label>
            <PasswordInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
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
              {savingPassword ? tCommon("saving") : t("updatePassword")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPasswordModalOpen(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Change Username Modal */}
      <Dialog
        open={usernameModalOpen}
        onOpenChange={setUsernameModalOpen}
        title={t("changeUsernameTitle")}
        description={t("changeUsernameDesc")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleChangeUsername();
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <label htmlFor="new-username" className="text-sm font-medium text-[#4e3d2c]">
              {t("newUsername")}
            </label>
            <Input
              id="new-username"
              value={newUsername}
              onChange={(e) =>
                setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
              }
              placeholder={t("usernamePlaceholder")}
              autoComplete="username"
              pattern="^[a-z0-9][a-z0-9_\-]*$"
              minLength={3}
              maxLength={32}
              required
            />
            <p className="text-xs text-[#8d7760]">{t("usernameHint")}</p>
          </div>

          {hasCredentialProvider && (
            <div className="grid gap-2">
              <label
                htmlFor="username-confirm-password"
                className="text-sm font-medium text-[#4e3d2c]"
              >
                {t("currentPassword")}
              </label>
              <PasswordInput
                id="username-confirm-password"
                value={usernameModalPassword}
                onChange={(e) => setUsernameModalPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          )}

          {usernameError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {usernameError}
            </p>
          ) : null}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={savingUsername}>
              {savingUsername ? tCommon("saving") : t("updateUsername")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setUsernameModalOpen(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Change Email Modal */}
      <Dialog
        open={emailModalOpen}
        onOpenChange={(open) => {
          setEmailModalOpen(open);
          if (!open) {
            setEmailChangeSent(false);
            setEmailError(null);
          }
        }}
        title={t("changeEmailTitle")}
        description={t("changeEmailDesc")}
      >
        {emailChangeSent ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {t("emailVerificationSentLong", { email: newEmailValue })}
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" onClick={() => setEmailModalOpen(false)}>
                {tCommon("close")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRequestEmailChange();
            }}
            className="space-y-4"
          >
            <div className="grid gap-2">
              <label htmlFor="new-email-input" className="text-sm font-medium text-[#4e3d2c]">
                {t("newEmail")}
              </label>
              <Input
                id="new-email-input"
                type="email"
                value={newEmailValue}
                onChange={(e) => setNewEmailValue(e.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="grid gap-2">
              <label
                htmlFor="email-confirm-password"
                className="text-sm font-medium text-[#4e3d2c]"
              >
                {t("currentPassword")}
              </label>
              <PasswordInput
                id="email-confirm-password"
                value={emailModalPassword}
                onChange={(e) => setEmailModalPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {emailError ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {emailError}
              </p>
            ) : null}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={requestingEmailChange}>
                {requestingEmailChange ? tCommon("saving") : t("sendVerificationLink")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEmailModalOpen(false)}>
                {tCommon("cancel")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </PageLayout>
  );
}
