"use client";

import { isValidUsername } from "@shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DesktopWindowControls } from "@/components/DesktopWindowControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/AuthContext";
import { readableError } from "@/lib/errors";

/** First-run page: choose an account before creating any permanent Steam identity. */
export function SteamAccountSetup() {
  const t = useTranslations("steamAccount");
  const {
    auth,
    authBootstrapped,
    steamProfileDefaults,
    finishSteamSetup,
    skipSteamSetup,
    onOpenAuth,
  } = useAuth();
  const router = useRouter();
  const [newPlayer, setNewPlayer] = useState(false);
  const [username, setUsername] = useState(steamProfileDefaults?.suggestedUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = authBootstrapped && auth?.player.kind === "account" ? auth.player : null;
  const pending = busy || !authBootstrapped;

  async function finish(action: "create" | "link") {
    setBusy(true);
    setError(null);
    try {
      await finishSteamSetup?.(action, username);
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-6 py-12"
      aria-labelledby="steam-setup-title"
    >
      <span className="font-display text-5xl text-[#4e3d2c]" aria-hidden="true">
        跳
      </span>
      <h1 id="steam-setup-title" className="font-display text-3xl text-[#2b1e14]">
        {t("title")}
      </h1>
      <p className="text-[#7b6550]">{t("description")}</p>
      {steamProfileDefaults?.displayName && (
        <div className="flex items-center gap-3">
          {steamProfileDefaults.avatarUrl && (
            <img
              src={steamProfileDefaults.avatarUrl}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl object-cover"
              referrerPolicy="no-referrer"
            />
          )}
          <p className="text-sm text-[#7b6550]">
            {t("steamProfile", { username: steamProfileDefaults.displayName })}
          </p>
        </div>
      )}
      {account ? (
        <>
          <p className="text-sm text-[#4e3d2c]">
            {t("signedInAs", { username: account.displayName })}
          </p>
          <Button disabled={pending} onClick={() => void finish("link")}>
            {busy ? t("working") : t("linkAccount")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => onOpenAuth("login")}>
            {t("differentAccount")}
          </Button>
        </>
      ) : newPlayer ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void finish("create");
          }}
        >
          <label htmlFor="steam-username" className="text-sm text-[#4e3d2c]">
            {t("username")}
          </label>
          <Input
            id="steam-username"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            autoComplete="username"
            minLength={3}
            maxLength={32}
            required
            aria-describedby="steam-username-hint"
          />
          {steamProfileDefaults?.suggestedUsername && (
            <p className="text-sm text-[#7b6550]">{t("prefilledHint")}</p>
          )}
          <p id="steam-username-hint" className="text-sm text-[#7b6550]">
            {t("usernameHint")}
          </p>
          <Button type="submit" disabled={pending || !isValidUsername(username)}>
            {busy ? t("working") : t("continueSteam")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setNewPlayer(false)}
          >
            {t("back")}
          </Button>
        </form>
      ) : (
        <>
          <Button disabled={pending} onClick={() => setNewPlayer(true)}>
            {t("newPlayer")}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => onOpenAuth("login")}>
            {t("existingPlayer")}
          </Button>
          <p className="text-sm text-[#7b6550]">{t("existingHint")}</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => {
          skipSteamSetup?.();
          router.replace("/play");
        }}
      >
        {t("skip")}
      </Button>
      <DesktopWindowControls />
    </section>
  );
}
