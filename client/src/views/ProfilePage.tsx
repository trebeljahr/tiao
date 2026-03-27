import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getAccountProfile,
  type AccountProfile,
  updateAccountProfile,
  uploadAccountProfilePicture,
} from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";

const PROFILE_PIC_SIZE = 512;
const PROFILE_PIC_QUALITY = 0.85;

function resizeImage(file: File): Promise<File> {
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
            reject(new Error("Failed to resize image"));
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
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "Just now";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ProfilePage() {
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
      const response = await updateAccountProfile({
        displayName,
        email: email || undefined,
      });
      onAuthChange(response.auth);
      setProfile(response.profile);
      setDisplayName(response.profile.displayName);
      setEmail(response.profile.email || "");
      setSuccessMessage("Profile saved.");
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
      setPasswordError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
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
      setSuccessMessage("Password changed.");
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
        toastError("Please select an image file.");
        return;
      }
      if (!auth || auth.player.kind !== "account") return;

      setUploading(true);
      setPageError(null);

      try {
        const resized = await resizeImage(file);
        const objectUrl = URL.createObjectURL(resized);
        setPreviewUrl(objectUrl);
        setSelectedFile(resized);

        const response = await uploadAccountProfilePicture(resized);
        onAuthChange(response.auth);
        setProfile(response.profile);
        setSelectedFile(null);
        setSuccessMessage("Profile picture updated.");
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
    [auth, onAuthChange],
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
              <CardTitle>Account profile</CardTitle>
              <CardDescription>
                Save a display name, email, and profile picture on the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                Guest sessions are great for quick matches, but server-backed
                profiles need a full account.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => onOpenAuth("signup")}>Create account</Button>
                <Button variant="outline" onClick={() => onOpenAuth("login")}>
                  Sign in
                </Button>
                <Button variant="ghost" onClick={() => router.push("/")}>
                  Back to lobby
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {auth?.player.kind === "account" ? (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>Picture</CardTitle>
                <CardDescription>
                  Upload a profile image that follows you around the app.
                </CardDescription>
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
                    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
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
                        <span className="text-sm font-medium text-white">Change photo</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-4 text-center">
                      <span className="font-display text-5xl text-[#2d2016]/30">
                        {(displayName || auth.player.displayName).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="text-xs text-[#8b7659]">
                        {dragging ? "Drop image here" : "Click, drag, or paste"}
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

                <p className="text-center text-xs text-[#8b7659]">
                  Drop an image, paste from clipboard, or click to browse
                </p>
              </CardContent>
            </Card>

            <Card className={paperCard}>
              <CardHeader>
                <CardTitle>Basic info</CardTitle>
                <CardDescription>
                  Keep your game identity polished without leaving the app.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                    Loading your saved profile...
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
                        Display name
                      </label>
                      <Input
                        id="profile-display-name"
                        name="name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder="Your Name"
                        autoComplete="name"
                        required
                      />
                    </div>

                    <div className="grid gap-2">
                      <label
                        htmlFor="profile-email"
                        className="text-sm font-medium text-[#4e3d2c]"
                      >
                        Email (Optional)
                      </label>
                      <Input
                        id="profile-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </div>

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
                        Change password
                      </Button>
                    </div>

                    <div className="grid gap-3 rounded-2xl border border-[#dcc7a3] bg-[#fff9ef] px-4 py-3 text-sm text-[#6f5a45]">
                      <p>Created: {formatTimestamp(profile?.createdAt)}</p>
                      <p>Updated: {formatTimestamp(profile?.updatedAt)}</p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={saving}>
                        {saving ? "Saving..." : "Save changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => router.push("/")}
                      >
                        Back to lobby
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
          </div>
        ) : null}
      </main>

      <Dialog
        open={passwordModalOpen}
        onOpenChange={setPasswordModalOpen}
        title="Change password"
        description="Enter your current password and choose a new one."
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
              Current password
            </label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="new-password" className="text-sm font-medium text-[#4e3d2c]">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="confirm-password" className="text-sm font-medium text-[#4e3d2c]">
              Confirm new password
            </label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
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
              {savingPassword ? "Saving..." : "Update password"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPasswordModalOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
