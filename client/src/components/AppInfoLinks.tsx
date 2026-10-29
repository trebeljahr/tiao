"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function AppInfoLinks({
  onNavigate,
  inSettings = false,
}: {
  onNavigate?: () => void;
  inSettings?: boolean;
}) {
  const t = useTranslations("nav");
  const tLegal = useTranslations("legalFooter");
  return (
    <div
      className={
        inSettings
          ? "mt-5 grid gap-3 text-sm text-[#7a6a58]"
          : "mt-5 flex flex-col items-center gap-2 text-xs text-[#7a6a58]"
      }
    >
      <a
        href="https://github.com/trebeljahr/tiao/issues/new/choose"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-medium transition-colors hover:bg-[rgba(0,0,0,0.04)] hover:text-[#28170e]"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
        </svg>
        {t("reportIssue")}
      </a>

      <nav
        className={
          inSettings
            ? "grid gap-2 sm:grid-cols-2"
            : "flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        }
      >
        <Link
          href="/about"
          onClick={onNavigate}
          className={
            inSettings
              ? "rounded-xl border border-[#dcc7a3] px-4 py-3 font-medium hover:bg-[#fffdf8] hover:text-[#28170e] focus-visible:outline-2 focus-visible:outline-[#b08440]"
              : "font-medium underline-offset-2 hover:text-[#28170e] hover:underline"
          }
        >
          {tLegal("about")}
        </Link>
        {!inSettings && (
          <span aria-hidden className="opacity-40">
            ·
          </span>
        )}
        <Link
          href="/press"
          onClick={onNavigate}
          className={
            inSettings
              ? "rounded-xl border border-[#dcc7a3] px-4 py-3 font-medium hover:bg-[#fffdf8] hover:text-[#28170e] focus-visible:outline-2 focus-visible:outline-[#b08440]"
              : "font-medium underline-offset-2 hover:text-[#28170e] hover:underline"
          }
        >
          {tLegal("press")}
        </Link>
        {!inSettings && (
          <span aria-hidden className="opacity-40">
            ·
          </span>
        )}
        <Link
          href="/impressum"
          onClick={onNavigate}
          className={
            inSettings
              ? "rounded-xl border border-[#dcc7a3] px-4 py-3 font-medium hover:bg-[#fffdf8] hover:text-[#28170e] focus-visible:outline-2 focus-visible:outline-[#b08440]"
              : "font-medium underline-offset-2 hover:text-[#28170e] hover:underline"
          }
        >
          {tLegal("impressum")}
        </Link>
        {!inSettings && (
          <span aria-hidden className="opacity-40">
            ·
          </span>
        )}
        <Link
          href="/privacy"
          onClick={onNavigate}
          className={
            inSettings
              ? "rounded-xl border border-[#dcc7a3] px-4 py-3 font-medium hover:bg-[#fffdf8] hover:text-[#28170e] focus-visible:outline-2 focus-visible:outline-[#b08440]"
              : "font-medium underline-offset-2 hover:text-[#28170e] hover:underline"
          }
        >
          {tLegal("privacy")}
        </Link>
      </nav>

      <p className="tracking-wide">v{process.env.APP_VERSION}</p>
    </div>
  );
}
