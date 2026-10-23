"use client";

import { isValidUsername } from "@shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SteamWindowControls } from "@/components/SteamWindowControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/AuthContext";
import { readableError } from "@/lib/errors";

/** First-run page: choose an account before creating any permanent Steam identity. */
export function SteamAccountSetup() {
  const t = useTranslations("steamAccount");
  const { auth, finishSteamSetup, skipSteamSetup, onOpenAuth } = useAuth();
  const router = useRouter();
  const [newPlayer, setNewPlayer] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = auth?.player.kind === "account" ? auth.player : null;

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
      {account ? (
        <>
          <p className="text-sm text-[#4e3d2c]">
            {t("signedInAs", { username: account.displayName })}
          </p>
          <Button disabled={busy} onClick={() => void finish("link")}>
            {busy ? t("working") : t("linkAccount")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onOpenAuth("login")}>
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
          <p id="steam-username-hint" className="text-sm text-[#7b6550]">
            {t("usernameHint")}
          </p>
          <Button type="submit" disabled={busy || !isValidUsername(username)}>
            {busy ? t("working") : t("continueSteam")}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setNewPlayer(false)}>
            {t("back")}
          </Button>
        </form>
      ) : (
        <>
          <Button disabled={busy} onClick={() => setNewPlayer(true)}>
            {t("newPlayer")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => onOpenAuth("login")}>
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
        disabled={busy}
        onClick={() => {
          skipSteamSetup?.();
          router.replace("/play");
        }}
      >
        {t("skip")}
      </Button>
      <SteamWindowControls />
    </section>
  );
}
