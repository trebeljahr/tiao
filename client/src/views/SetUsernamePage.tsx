"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUsername } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { isValidUsername } from "@shared";
import { readableError, toastError } from "@/lib/errors";

export function SetUsernamePage() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const { applyAuth } = useAuth();
  const [username, setUsernameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const valid = isValidUsername(sanitized);

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

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 sm:px-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#faf0da,#ecd4a7)] font-display text-4xl text-[#24160d] shadow-[0_18px_30px_-22px_rgba(36,22,13,0.85)]">
          跳
        </div>

        <Card className={paperCard + " w-full"}>
          <CardContent className="flex flex-col gap-5 pt-8 pb-8">
            <div className="text-center">
              <h1 className="font-display text-2xl font-bold text-[#2b1e14]">{t("title")}</h1>
              <p className="mt-2 text-sm text-[#8d7760]">{t("description")}</p>
            </div>

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
                  pattern="^[a-z0-9][a-z0-9_-]*$"
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
        </Card>
      </main>
    </div>
  );
}
