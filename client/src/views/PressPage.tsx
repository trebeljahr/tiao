"use client";

/**
 * Press page: fact sheet, description paragraphs, story angles, quotes,
 * creator credits, contact, image-kit download and technical facts for
 * journalists and reviewers.
 *
 * The copy mirrors the press kit in the ricos.site vault
 * (projects/tiao/tiao-press-kit.md). Keep both in sync — the vault file is
 * the source, this page is the published surface.
 */

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PageLayout } from "@/components/PageLayout";
import { PaperCard } from "@/components/ui/paper-card";
import { Link } from "@/i18n/navigation";
import { PRESS_EMAIL, PRESS_KIT_ZIP_PATH } from "@/lib/pressKit";

const SITE_URL = "https://playtiao.com";
const SOURCE_URL = "https://github.com/trebeljahr/tiao";

const linkClass =
  "font-medium text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]";

const FACT_ROWS = [
  "Name",
  "Url",
  "Source",
  "Designer",
  "Builder",
  "Year",
  "Players",
  "Time",
  "Age",
  "Price",
  "Platforms",
  "Languages",
  "Mechanics",
] as const;

const TECH_ROWS = [
  "Frontend",
  "Backend",
  "Database",
  "Auth",
  "Hosting",
  "Analytics",
  "I18n",
  "Pwa",
  "License",
] as const;

const KIT_ASSETS = [
  { file: "hero-board.png", key: "assetHeroBoard" },
  { file: "mid-game-trap.png", key: "assetMidGameTrap" },
  { file: "chain-capture-moment.png", key: "assetChainCapture" },
  { file: "home-page.png", key: "assetHomePage" },
  { file: "lobby.png", key: "assetLobby" },
  { file: "profile.png", key: "assetProfile" },
  { file: "og-card.png", key: "assetOgCard" },
  { file: "logo-wordmark.svg", key: "assetLogo" },
  { file: "walkthrough.mp4", key: "assetWalkthrough" },
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-xl font-semibold text-[#3a2b1b]">{title}</h2>
        {hint ? <p className="text-sm text-[#8d7760]">{hint}</p> : null}
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-[#4a3728]">{children}</div>
    </section>
  );
}

function FactTable({ rows }: { rows: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="font-semibold text-[#3a2b1b]">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {text.split("\n\n").map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}

export function PressPage({ downloadAvailable }: { downloadAvailable: boolean }) {
  const t = useTranslations("press");

  const factValues: Record<(typeof FACT_ROWS)[number], ReactNode> = {
    Name: t("factNameValue"),
    Url: <ExternalLink href={SITE_URL}>{t("factUrlValue")}</ExternalLink>,
    Source: (
      <>
        <ExternalLink href={SOURCE_URL}>{t("factSourceValue")}</ExternalLink>{" "}
        {t("factSourceLicense")}
      </>
    ),
    Designer: t("factDesignerValue"),
    Builder: t("factBuilderValue"),
    Year: t("factYearValue"),
    Players: t("factPlayersValue"),
    Time: t("factTimeValue"),
    Age: t("factAgeValue"),
    Price: t("factPriceValue"),
    Platforms: t("factPlatformsValue"),
    Languages: t("factLanguagesValue"),
    Mechanics: t("factMechanicsValue"),
  };

  return (
    <PageLayout maxWidth="max-w-3xl">
      <PaperCard className="p-6 sm:p-8">
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="text-3xl font-semibold text-[#2a1d13]">{t("title")}</h1>
            <p className="text-sm leading-relaxed text-[#4a3728]">{t("intro")}</p>
          </header>

          <Section title={t("factsTitle")}>
            <FactTable
              rows={FACT_ROWS.map((row) => ({ label: t(`fact${row}`), value: factValues[row] }))}
            />
          </Section>

          <Section title={t("oneSentenceTitle")}>
            <p className="text-base">{t("oneSentence")}</p>
          </Section>

          <Section title={t("lengthsTitle")} hint={t("lengthsHint")}>
            {(["short", "medium", "long"] as const).map((length) => (
              <div key={length} className="space-y-1">
                <h3 className="font-semibold text-[#3a2b1b]">{t(`${length}Label`)}</h3>
                <Paragraphs text={t(`${length}Body`)} />
              </div>
            ))}
          </Section>

          <Section title={t("hookTitle")} hint={t("hookHint")}>
            <ul className="list-disc space-y-2 pl-5">
              {([1, 2, 3] as const).map((n) => (
                <li key={n}>
                  <strong className="font-semibold text-[#3a2b1b]">{t(`hook${n}Title`)}</strong>{" "}
                  {t(`hook${n}Body`)}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("quotesTitle")}>
            {([1, 2, 3] as const).map((n) => (
              <blockquote
                key={n}
                className="border-l-2 border-[#d8c29c] pl-4 italic text-[#4a3728]"
              >
                <p>{t(`quote${n}`)}</p>
              </blockquote>
            ))}
          </Section>

          <Section title={t("creditsTitle")}>
            <FactTable
              rows={[
                {
                  label: t("creditDesigner"),
                  value: (
                    <>
                      Andreas Edmeier ·{" "}
                      <Link href="/creators/andreas" className={linkClass}>
                        {t("creditProfile")}
                      </Link>
                    </>
                  ),
                },
                {
                  label: t("creditBuilder"),
                  value: (
                    <>
                      Rico Trebeljahr ·{" "}
                      <Link href="/creators/rico" className={linkClass}>
                        {t("creditProfile")}
                      </Link>
                    </>
                  ),
                },
              ]}
            />
          </Section>

          <Section title={t("contactTitle")}>
            <p>
              <span className="font-semibold text-[#3a2b1b]">{t("contactEmailLabel")}:</span>{" "}
              <a href={`mailto:${PRESS_EMAIL}`} className={linkClass}>
                {PRESS_EMAIL}
              </a>
            </p>
            <p>{t("contactResponse")}</p>
            <p>{t("contactDesign")}</p>
          </Section>

          <Section title={t("downloadTitle")} hint={t("downloadHint")}>
            {downloadAvailable ? (
              <a
                href={`/${PRESS_KIT_ZIP_PATH}`}
                download
                className="inline-flex items-center gap-2 rounded-full border border-[#d8c29c] bg-[#fff8ee]/80 px-4 py-2 text-sm font-semibold text-[#5d4732] transition-colors hover:bg-[#f5e8d4]"
              >
                {t("downloadButton")}
              </a>
            ) : (
              <p
                role="status"
                className="rounded-xl border border-dashed border-[#d8c29c] bg-[#fff8ee]/60 px-4 py-3 text-[#5d4732]"
              >
                {t.rich("downloadComingSoon", {
                  email: () => (
                    <a href={`mailto:${PRESS_EMAIL}`} className={linkClass}>
                      {PRESS_EMAIL}
                    </a>
                  ),
                })}
              </p>
            )}
            <div className="space-y-1">
              <h3 className="font-semibold text-[#3a2b1b]">{t("downloadContentsTitle")}</h3>
              <ul className="list-disc space-y-1 pl-5">
                {KIT_ASSETS.map((asset) => (
                  <li key={asset.file}>
                    <code className="rounded bg-[#f5e8d4] px-1 py-0.5 text-xs">{asset.file}</code>{" "}
                    {t(asset.key)}
                  </li>
                ))}
              </ul>
            </div>
            <p>{t("downloadReuse")}</p>
          </Section>

          <Section title={t("techTitle")} hint={t("techHint")}>
            <FactTable
              rows={TECH_ROWS.map((row) => ({
                label: t(`tech${row}`),
                value: t(`tech${row}Value`),
              }))}
            />
          </Section>

          <Section title={t("aboutTitle")}>
            <blockquote className="border-l-2 border-[#d8c29c] pl-4 text-[#4a3728]">
              <p>{t("aboutBody")}</p>
            </blockquote>
          </Section>

          <Section title={t("citeTitle")}>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("citeGame")}</li>
              <li>{t("citeWebsite")}</li>
              <li>{t("citeLicense")}</li>
            </ul>
          </Section>

          <Section title={t("linksTitle")}>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <ExternalLink href={SITE_URL}>{t("linkSite")}</ExternalLink>
              </li>
              <li>
                <ExternalLink href={SOURCE_URL}>{t("linkSource")}</ExternalLink>
              </li>
              <li>
                <Link href="/tutorial" className={linkClass}>
                  {t("linkTutorial")}
                </Link>
              </li>
            </ul>
          </Section>
        </div>
      </PaperCard>
    </PageLayout>
  );
}
