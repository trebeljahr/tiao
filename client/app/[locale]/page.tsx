import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FaGithub } from "react-icons/fa";
import { BoardIllustration } from "@/components/public/BoardIllustration";
import { EntryRedirect } from "@/components/public/EntryRedirect";
import { CommunityPreview, MatchPreview } from "@/components/public/FeaturePreviews";
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
          <a className={styles.openSourceLink} href="https://github.com/trebeljahr/tiao">
            <FaGithub size={20} aria-hidden="true" />
            {t("openSourceNote")}
          </a>
        </div>
        <div className={styles.heroArt}>
          <BoardIllustration title={t("boardAlt")} />
        </div>
      </section>
      <section className={styles.features} aria-labelledby="features-title">
        <header className={styles.featuresHeading}>
          <p className={styles.eyebrow}>{t("featuresEyebrow")}</p>
          <h2 id="features-title">{t("featuresTitle")}</h2>
          <p className={styles.sectionIntro}>{t("featuresIntro")}</p>
        </header>
        <div className={styles.featureLayout}>
          <MatchPreview />
          <div className={styles.featureDetails}>
            <CommunityPreview />
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
      <section className={styles.explanation} aria-labelledby="source-title">
        <div>
          <p className={styles.eyebrow}>{t("openSourceEyebrow")}</p>
          <h2 id="source-title">{t("openSourceTitle")}</h2>
        </div>
        <div className={styles.ruleCopy}>
          <p>{t("openSourceBody")}</p>
          <div className={styles.actions}>
            <a className={styles.contribute} href="https://github.com/trebeljahr/tiao">
              <FaGithub size={24} aria-hidden="true" />
              {t("contribute")}
            </a>
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
