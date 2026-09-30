import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BoardIllustration } from "@/components/public/BoardIllustration";
import { CaptureDemo } from "@/components/public/CaptureDemo";
import { EntryRedirect } from "@/components/public/EntryRedirect";
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
            Tiao
          </h1>
          <h2>{t("headline")}</h2>
          <p className={styles.intro}>{t("intro")}</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/play">
              {t("play")} <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.textLink} href="/tutorial">
              {t("tutorial")}
            </Link>
          </div>
          <p className={styles.note}>{t("note")}</p>
        </div>
        <div className={styles.heroArt}>
          <BoardIllustration title={t("boardAlt")} />
        </div>
      </section>
      <section className={styles.explanation} aria-labelledby="rules-title">
        <div>
          <p className={styles.eyebrow}>{t("navRules")}</p>
          <h2 id="rules-title">{t("rulesTitle")}</h2>
        </div>
        <div className={styles.ruleCopy}>
          <p>{t("rulesBody")}</p>
          <p>{t("captureBody")}</p>
          <Link className={styles.textLink} href="/rules">
            {t("learn")} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <section className={styles.captureSection} aria-label={t("captureEyebrow")}>
        <div className={styles.captureCopy}>
          <p className={styles.eyebrow}>{t("captureEyebrow")}</p>
          <h2>{t("captureTitle")}</h2>
        </div>
        <CaptureDemo />
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
      <PublicFooter />
    </div>
  );
}
