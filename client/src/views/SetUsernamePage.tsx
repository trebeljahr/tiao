"use client";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUsername, uploadAccountProfilePicture } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { isValidUsername } from "@shared";
import { readableError, toastError } from "@/lib/errors";

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

export function SetUsernamePage() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const { auth, applyAuth } = useAuth();
  const [username, setUsernameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ssoImage = auth?.player.profilePicture ?? null;
  const profileImage = previewUrl || ssoImage;

  // Show the SSO profile picture if available (synced from the SSO provider)
  const ssoProfilePicture = auth?.player.profilePicture;

  const sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const valid = isValidUsername(sanitized);

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const resized = await resizeImage(file);
        const preview = URL.createObjectURL(resized);
        setPreviewUrl(preview);
        const response = await uploadAccountProfilePicture(resized);
        applyAuth(response.auth);
      } catch (err) {
        toastError(readableError(err));
      } finally {
        setUploading(false);
      }
    },
    [applyAuth],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;

    setBusy(true);
    setError(null);

    try {
      const result = await setUsername(sanitized);
      applyAuth(result.auth);
      router.replace("/");
    } catch (err: unknown) {
      const message = readableError(err);
      setError(message);
      toastError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 sm:px-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#faf0da,#ecd4a7)] font-display text-4xl text-[#24160d] shadow-[0_18px_30px_-22px_rgba(36,22,13,0.85)]">
          跳
        </div>

        <PaperCard className="w-full">
          <CardContent className="flex flex-col gap-5 pt-8 pb-8">
            {ssoProfilePicture && (
              <div className="mx-auto h-20 w-20 overflow-hidden rounded-2xl border-2 border-[#d4bd94] shadow-[0_12px_30px_-18px_rgba(58,35,16,0.6)]">
                <img src={ssoProfilePicture} alt="" className="h-full w-full object-cover" />
              </div>
            )}

            <div className="text-center">
              <h1 className="font-display text-2xl font-bold text-[#2b1e14]">{t("title")}</h1>
              <p className="mt-2 text-sm text-[#8d7760]">{t("description")}</p>
            </div>

            {/* Profile picture */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                className="group relative mx-auto flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-[#d4bd94] bg-[linear-gradient(180deg,#fbf2de,#ead5aa)] shadow-[0_12px_30px_-16px_rgba(58,35,16,0.5)] transition-all hover:border-[#c4a46e]"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(251,242,222,0.85)]">
                    <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-[#d4bd94] border-t-[#8b6914]" />
                  </div>
                )}
                {profileImage ? (
                  <>
                    <img src={profileImage} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.4)] opacity-0 transition-opacity group-hover:opacity-100">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="white"
                        className="h-5 w-5"
                      >
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                    </div>
                  </>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-8 w-8 text-[#2d2016]/30"
                  >
                    <path d="M1 8a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 018.07 3h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0016.07 6H17a2 2 0 012 2v7a2 2 0 01-2 2H3a2 2 0 01-2-2V8zm13.5 3a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM10 14a3 3 0 100-6 3 3 0 000 6z" />
                  </svg>
                )}
              </button>
              <span className="text-xs text-[#a8957e]">{t("profilePictureHint")}</span>
            </div>

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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="onboarding-username"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  {t("usernameLabel")}
                </label>
                <Input
                  id="onboarding-username"
                  name="username"
                  value={sanitized}
                  onChange={(e) =>
                    setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                  }
                  placeholder={t("usernamePlaceholder")}
                  autoComplete="username"
                  pattern="^[a-z0-9][a-z0-9_\-]*$"
                  minLength={3}
                  maxLength={32}
                  title={t("usernameHint")}
                  required
                  autoFocus
                />
                <p className="text-xs text-[#a8957e]">{t("usernameHint")}</p>
              </div>

              {error && <p className="text-sm font-medium text-red-600">{error}</p>}

              <Button type="submit" className="w-full" disabled={busy || !valid}>
                {busy ? t("saving") : t("continue")}
              </Button>
            </form>
          </CardContent>
        </PaperCard>
      </main>
    </div>
  );
}
