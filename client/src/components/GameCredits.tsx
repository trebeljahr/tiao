"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAppInfoInSettings } from "@/lib/distributionChannel";

export function GameCredits() {
  const t = useTranslations("lobby");
  return (
    <p>
      {t("footer")}{" "}
      <Link
        className="font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
        href="/creators/andreas"
      >
        Andreas Edmeier
      </Link>
      . {t("footerBuiltWith")}{" "}
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="#e8839b"
        className="inline-block h-3.5 w-3.5 align-[-0.15em]"
        style={{ animation: "heartbeat 2s ease-in-out infinite" }}
      >
        <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
      </svg>
      <span className="sr-only">{t("footerLove")}</span> {t("footerBy")}{" "}
      <Link
        className="font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
        href="/creators/rico"
      >
        Rico Trebeljahr
      </Link>
      .
    </p>
  );
}

export function LobbyFooter() {
  const t = useTranslations("lobby");
  const appInfoInSettings = useAppInfoInSettings();
  if (appInfoInSettings) return null;
  return (
    <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-center text-xs text-[#a8957e] sm:px-6">
      <GameCredits />
      <p className="mt-2">
        <Link
          className="font-medium text-[#8b7356] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#5d4732]"
          href="/about"
        >
          {t("footerAbout")}
        </Link>
      </p>
    </footer>
  );
}
