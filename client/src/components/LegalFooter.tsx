"use client";

/**
 * Minimal legal footer — just the links German law requires to be
 * "easily recognisable, immediately reachable, and permanently
 * available": Impressum (§ 5 TMG) and Datenschutzerklärung (art. 13
 * GDPR). Rendered at the bottom of every page via PageLayout.
 *
 * Deliberately bare: no branding, no nav, no social links. Those
 * don't belong in the legal footer and we don't need them site-wide.
 */

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function LegalFooter() {
  const t = useTranslations("legalFooter");

  return (
    <footer className="mt-auto border-t border-[#e8dcc2] bg-transparent px-4 py-4 text-xs text-[#7b6550] sm:px-6 lg:px-8">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href="/impressum" className="underline-offset-2 hover:underline">
          {t("impressum")}
        </Link>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <Link href="/privacy" className="underline-offset-2 hover:underline">
          {t("privacy")}
        </Link>
      </nav>
    </footer>
  );
}
