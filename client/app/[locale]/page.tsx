import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BoardIllustration } from "@/components/public/BoardIllustration";
import { CaptureDemo } from "@/components/public/CaptureDemo";
import { EntryRedirect } from "@/components/public/EntryRedirect";
import { PlatformDownloads } from "@/components/public/PlatformDownloads";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import styles from "@/components/public/PublicSite.module.css";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";
import { LobbyPage } from "@/views/LobbyPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  return {
    title: { absolute: t("metaTitle") },
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/"),
    openGraph: { title: t("metaTitle"), description: t("metaDescription"), images: OG_IMAGES },
    twitter: { title: t("metaTitle"), description: t("metaDescription") },
  };
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Installed apps keep their existing launch URL and offline lobby behavior.
  if (
    process.env.NEXT_PUBLIC_PLATFORM === "desktop" ||
    process.env.NEXT_PUBLIC_PLATFORM === "mobile"
  ) {
    return <LobbyPage />;
  }
  const t = await getTranslations("landing");
  return (
    <div className={styles.site}>
      <EntryRedirect />
      <PublicHeader />
      <section className={styles.hero} aria-labelledby="tiao-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{t("eyebrow")}</p>
          <h1 id="tiao-title" className={styles.wordmark}>
            <span className={styles.wordmarkText}>Tiao</span>
            <span className={styles.wordmarkBadge} lang="zh-Hans">
              跳
            </span>
          </h1>
          <h2>{t("headline")}</h2>
          <p className={styles.intro}>{t("intro")}</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/play">
              {t("play")} <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.textLink} href="/rules">
              {t("tutorial")}
            </Link>
          </div>
        </div>
        <div className={styles.heroArt}>
          <BoardIllustration title={t("boardAlt")} />
        </div>
      </section>
      <section className={styles.captureSection} aria-labelledby="capture-title">
        <div className={styles.captureCopy}>
          <p className={styles.eyebrow}>{t("captureEyebrow")}</p>
          <h2 id="capture-title">{t("captureTitle")}</h2>
          <p>{t("howTurn")}</p>
          <p>{t("captureDetail")}</p>
          <p className={styles.muted}>{t("howWin")}</p>
          <Link className={styles.textLink} href="/rules">
            {t("learn")}
          </Link>
        </div>
        <CaptureDemo />
      </section>
      <section className={styles.features} aria-labelledby="features-title">
        <header className={styles.featuresHeading}>
          <p className={styles.eyebrow}>{t("featuresEyebrow")}</p>
          <h2 id="features-title">{t("featuresTitle")}</h2>
          <p className={styles.sectionIntro}>{t("featuresIntro")}</p>
        </header>
        <div className={styles.featureLayout}>
          <figure className={styles.matchPreview}>
            <Image
              src="/screenshots/match-board.webp"
              alt={t("matchAlt")}
              width={950}
              height={950}
              sizes="(max-width: 700px) 88vw, 52vw"
            />
            <figcaption>{t("matchCaption")}</figcaption>
          </figure>
          <div className={styles.featureDetails}>
            <figure className={styles.playerPreview}>
              <Image
                src="/screenshots/match-players.webp"
                alt={t("playersAlt")}
                width={454}
                height={380}
                sizes="(max-width: 700px) 88vw, 36vw"
              />
              <figcaption>{t("playersCaption")}</figcaption>
            </figure>
            <div className={styles.featureLinks}>
              {(
                [
                  ["friends", "/friends"],
                  ["tournaments", "/tournaments"],
                  ["spectating", "/play"],
                ] as const
              ).map(([feature, href]) => (
                <Link key={feature} href={href}>
                  <div>
                    <h3>{t(`${feature}Title`)}</h3>
                    <p>{t(`${feature}Body`)}</p>
                  </div>
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className={styles.playSection} aria-labelledby="ways-title">
        <div>
          <p className={styles.eyebrow}>{t("waysEyebrow")}</p>
          <h2 id="ways-title">{t("waysTitle")}</h2>
        </div>
        <div className={styles.playOptions}>
          <Link href="/computer">
            <span>
              <strong>{t("computer")}</strong>
              <small>{t("computerDetail")}</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/local">
            <span>
              <strong>{t("local")}</strong>
              <small>{t("localDetail")}</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/play">
            <span>
              <strong>{t("online")}</strong>
              <small>{t("onlineDetail")}</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <PlatformDownloads />
      <section className={styles.explanation} aria-labelledby="story-title">
        <div>
          <p className={styles.eyebrow}>{t("storyEyebrow")}</p>
          <h2 id="story-title">{t("storyTitle")}</h2>
        </div>
        <div className={styles.ruleCopy}>
          <p>{t("storyBody")}</p>
          <div className={styles.actions}>
            <Link className={styles.textLink} href="/about">
              {t("storyLink")}
            </Link>
            <a className={styles.textLink} href="https://github.com/trebeljahr/tiao">
              {t("sourceLink")}
            </a>
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
