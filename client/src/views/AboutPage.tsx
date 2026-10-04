"use client";

/**
 * About page: what Tiao is, why the code is open, how to support it, who
 * made it, and the AGPL notice. Sits next to /tutorial (rules),
 * /creators/* (credits) and /impressum (legal).
 *
 * All copy is driven by i18n under the `about` namespace. External links
 * that depend on deploy-time config (Ko-fi, Discord) are read from
 * NEXT_PUBLIC_* env vars and rendered only when set.
 */

import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";
import { Link } from "@/i18n/navigation";
import { useIsAppStoreChannel } from "@/lib/distributionChannel";

export const GITHUB_REPO_URL = "https://github.com/trebeljahr/tiao";
export const GITHUB_SPONSORS_URL = "https://github.com/sponsors/trebeljahr";
export const LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`;
export const LICENSE_EXCEPTIONS_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE-EXCEPTIONS.md`;

// Build-time inlined by Next.js. Unset → the corresponding link is hidden.
const KOFI_URL = process.env.NEXT_PUBLIC_KOFI_URL;
const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL;

const linkClass =
  "font-medium text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-2">
      <h2 className="text-xl font-semibold text-[#3a2b1b]">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-[#4a3728]">{children}</div>
    </section>
  );
}

export function AboutPage() {
  const t = useTranslations("about");
  // App-store builds must not link to external donation pages.
  const showDonations = !useIsAppStoreChannel();

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard className="p-6 sm:p-8">
        <div className="space-y-6">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold text-[#2a1d13]">{t("title")}</h1>
          </header>

          <Section id="what" title={t("whatTitle")}>
            <p>{t("whatIntro")}</p>
            <p>{t("whatRules")}</p>
            <p>{t("whatSite")}</p>
          </Section>

          <Section id="open-source" title={t("openSourceTitle")}>
            <p>{t("openSourceWhy")}</p>
            <p>{t("openSourceLicense")}</p>
            <p>
              {t.rich("openSourceException", {
                exceptions: (chunks) => (
                  <ExternalLink href={LICENSE_EXCEPTIONS_URL}>{chunks}</ExternalLink>
                ),
              })}
            </p>
            <p>
              {t.rich("openSourceContribute", {
                repo: (chunks) => <ExternalLink href={GITHUB_REPO_URL}>{chunks}</ExternalLink>,
              })}
            </p>
          </Section>

          <Section id="support" title={t("supportTitle")}>
            <p>{showDonations ? t("supportIntro") : t("supportIntroStore")}</p>
            <ul className="list-disc space-y-1 pl-5">
              {showDonations && KOFI_URL && (
                <li>
                  <ExternalLink href={KOFI_URL}>{t("supportKofi")}</ExternalLink>
                  {" — "}
                  {t("supportKofiDesc")}
                </li>
              )}
              {showDonations && (
                <li>
                  <ExternalLink href={GITHUB_SPONSORS_URL}>{t("supportSponsors")}</ExternalLink>
                  {" — "}
                  {t("supportSponsorsDesc")}
                </li>
              )}
              <li>
                <ExternalLink href={GITHUB_REPO_URL}>{t("supportCode")}</ExternalLink>
                {" — "}
                {t("supportCodeDesc")}
              </li>
              <li>
                {DISCORD_URL ? (
                  <>
                    <ExternalLink href={DISCORD_URL}>{t("supportDiscord")}</ExternalLink>
                    {" — "}
                    {t("supportDiscordDesc")}
                  </>
                ) : (
                  t("supportDiscordPlanned")
                )}
              </li>
            </ul>
          </Section>

          <Section id="people" title={t("peopleTitle")}>
            <p>
              {t.rich("peopleBody", {
                andreas: (chunks) => (
                  <Link href="/creators/andreas" className={linkClass}>
                    {chunks}
                  </Link>
                ),
                rico: (chunks) => (
                  <Link href="/creators/rico" className={linkClass}>
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </Section>

          <Section id="license" title={t("licenseTitle")}>
            <p>
              {t.rich("licenseNotice", {
                license: (chunks) => <ExternalLink href={LICENSE_URL}>{chunks}</ExternalLink>,
                exceptions: (chunks) => (
                  <ExternalLink href={LICENSE_EXCEPTIONS_URL}>{chunks}</ExternalLink>
                ),
              })}
            </p>
            <p>
              <ExternalLink href={GITHUB_REPO_URL}>{t("licenseRepoLink")}</ExternalLink>
            </p>
          </Section>
        </div>
      </PaperCard>
    </PageLayout>
  );
}
