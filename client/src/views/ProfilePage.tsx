import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthResponse } from "@shared";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getAccountProfile,
  type AccountProfile,
  updateAccountProfile,
  uploadAccountProfilePicture,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import { getBadgesForPlayer, hasPreviewAccess, isAdmin } from "@/lib/featureGate";
import { UserBadge, type BadgeId, BADGE_DEFINITIONS, ALL_BADGE_IDS } from "@/components/UserBadge";
import { useSetActiveBadges } from "@/lib/useActiveBadge";
import { updateActiveBadges } from "@/lib/api";
import { useTranslations } from "next-intl";

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

function BadgeSelector({ auth }: { auth: AuthResponse | null }) {
  const t = useTranslations("profile");
  const badges = getBadgesForPlayer(auth);
  const [activeBadges, setActiveBadges] = useSetActiveBadges();

  if (!hasPreviewAccess(auth) || badges.length === 0) return null;

  const selectBadge = (badgeId: BadgeId) => {
    // Single-select: clicking the already-active badge deselects it
    const next = activeBadges.includes(badgeId) ? [] : [badgeId];
    setActiveBadges(next as BadgeId[]);
    // Fire-and-forget server sync
    void updateActiveBadges(next);
  };

  const hideAll = () => {
    setActiveBadges([]);
    void updateActiveBadges([]);
  };

  return (
    <Card className="border-[#dcc7a3]/60 bg-[linear-gradient(180deg,rgba(255,250,235,0.98),rgba(248,238,215,0.98))] shadow-[0_32px_72px_-28px_rgba(80,52,18,0.26)]">
      <CardHeader>
        <CardTitle>{t("badge")}</CardTitle>
        <CardDescription>{t("badgeDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {/* "None" option */}
          <button
            type="button"
            onClick={hideAll}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
              activeBadges.length === 0
                ? "border-[#8c7a5e] bg-[#f5ecd8] text-[#4e3d2c] shadow-sm"
                : "border-[#dcc7a3] text-[#9a8670] hover:border-[#b69a6e]",
            )}
          >
            {t("badgeHidden")}
          </button>

          {badges.map((badgeId) => {
            const def = BADGE_DEFINITIONS[badgeId];
            if (!def) return null;
            const isActive = activeBadges.includes(badgeId);

            return (
              <button
                key={badgeId}
                type="button"
                onClick={() => selectBadge(badgeId)}
                className={cn(
                  "rounded-xl border p-2 transition-all",
                  isActive
                    ? "border-[#8c7a5e] bg-[#f5ecd8] shadow-sm"
                    : "border-transparent hover:border-[#dcc7a3]",
                )}
              >
                <UserBadge badge={badgeId} />
              </button>
            );
          })}
        </div>

        {activeBadges.length > 0 && (
          <p className="mt-3 text-xs text-[#9a8670]">
            {t("badgeActive", {
              badge: activeBadges
                .map((id) => BADGE_DEFINITIONS[id as BadgeId]?.label)
                .filter(Boolean)
                .join(", "),
            })}
          </p>
        )}

        {/* Dev preview: show all badges at all sizes for testing */}
        {isAdmin(auth) && (
          <div className="mt-5 rounded-xl border border-dashed border-[#c4a978]/50 p-3">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#b09a78]">
              {t("devPreviewBadges")}
            </p>
            <div className="flex flex-col gap-3">
              {ALL_BADGE_IDS.map((id) => (
                <div key={id} className="flex items-center gap-3">
                  <UserBadge badge={id} />
                  <UserBadge badge={id} compact />
                  <span className="text-[11px] text-[#9a8670]">
                    {t("badgeTier", { tier: BADGE_DEFINITIONS[id].tier, id })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimestamp(value: string | undefined, justNowLabel: string) {
  if (!value) {
    return justNowLabel;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProfilePage() {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tError = useTranslations("error");
  const { auth, applyAuth: onAuthChange, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
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

  const providers = profile?.providers ?? [];
  const hasCredentialProvider = providers.includes("credential");
  const hasOAuthProvider = providers.some((p) => p !== "credential");
  const oauthProviderLabel = providers.find((p) => p !== "credential") ?? "OAuth";

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

  async function handleSaveProfile() {
    if (!auth || auth.player.kind !== "account") {
      return;
    }

    setSaving(true);
    setPageError(null);

    try {
      const body: { displayName?: string; email?: string } = { displayName };
      // Only send email if the user has a credential provider (OAuth emails are managed by the provider)
      if (hasCredentialProvider || !hasOAuthProvider) {
        body.email = email || undefined;
      }
      const response = await updateAccountProfile(body);
      onAuthChange(response.auth);
      setProfile(response.profile);
      setDisplayName(response.profile.displayName);
      setEmail(response.profile.email || "");
      setSuccessMessage(t("profileSaved"));
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setPageError(readableError(error));
      }
    } finally {
      setSaving(false);
    }
  }

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

  const profileImage = previewUrl || profile?.profilePicture;
  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,232,0.76),_transparent_62%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((value) => !value)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        {auth?.player.kind !== "account" ? (
          <Card className={paperCard}>
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
                <Button variant="ghost" onClick={() => router.push("/")}>
                  {tCommon("backToLobby")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {auth?.player.kind === "account" ? (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>{t("picture")}</CardTitle>
                <CardDescription>{t("pictureDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  ref={dropZoneRef}
                  role="button"
                  tabIndex={0}
                  className={`group relative mx-auto flex h-56 w-56 cursor-pointer items-center justify-center overflow-hidden rounded-[2rem] border-2 border-dashed transition-all ${
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
            </Card>

            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>{t("basicInfo")}</CardTitle>
                <CardDescription>{t("basicInfoDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                    {t("loadingProfile")}
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveProfile();
                    }}
                    className="space-y-4"
                  >
                    <div className="grid gap-2">
                      <label
                        htmlFor="profile-display-name"
                        className="text-sm font-medium text-[#4e3d2c]"
                      >
                        {t("username")}
                      </label>
                      <Input
                        id="profile-display-name"
                        name="name"
                        value={displayName}
                        onChange={(event) =>
                          setDisplayName(
                            event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                          )
                        }
                        placeholder={t("usernamePlaceholder")}
                        autoComplete="username"
                        pattern="^[a-z0-9][a-z0-9_-]*$"
                        minLength={3}
                        maxLength={32}
                        title="Lowercase letters, numbers, hyphens, and underscores only (3-32 chars)"
                        required
                      />
                      <p className="text-xs text-[#8d7760]">{t("usernameHint")}</p>
                    </div>

                    <div className="grid gap-2">
                      <label htmlFor="profile-email" className="text-sm font-medium text-[#4e3d2c]">
                        {t("emailOptional")}
                      </label>
                      <Input
                        id="profile-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                        readOnly={hasOAuthProvider && !hasCredentialProvider}
                      />
                      {hasOAuthProvider && !hasCredentialProvider && (
                        <p className="text-xs text-[#8d7760]">
                          Email is managed by your {oauthProviderLabel} account.
                        </p>
                      )}
                    </div>

                    {hasOAuthProvider && (
                      <div className="grid gap-2 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                        <p className="font-medium text-[#4e3d2c]">Connected accounts</p>
                        <div className="flex flex-wrap gap-2">
                          {(profile?.providers ?? [])
                            .filter((p) => p !== "credential")
                            .map((provider) => (
                              <span
                                key={provider}
                                className="inline-flex items-center gap-1.5 rounded-full border border-[#dcc7a3] bg-white px-3 py-1 text-xs font-medium capitalize"
                              >
                                {provider}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {hasCredentialProvider && (
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setPasswordError(null);
                            setCurrentPassword("");
                            setNewPassword("");
                            setConfirmPassword("");
                            setPasswordModalOpen(true);
                          }}
                        >
                          {t("changePassword")}
                        </Button>
                      </div>
                    )}

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

                    <div className="grid gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                      <p>
                        {t("created", { date: formatTimestamp(profile?.createdAt, t("justNow")) })}
                      </p>
                      <p>
                        {t("updated", { date: formatTimestamp(profile?.updatedAt, t("justNow")) })}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={saving}>
                        {saving ? tCommon("saving") : tCommon("save")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => router.push("/")}>
                        {tCommon("backToLobby")}
                      </Button>
                    </div>
                  </form>
                )}

                {successMessage ? (
                  <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {successMessage}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <BadgeSelector auth={auth} />
          </div>
        ) : null}
      </main>

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
    </div>
  );
}
