import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CaptureDemo } from "@/components/public/CaptureDemo";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
import styles from "@/components/public/PublicSite.module.css";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, OG_IMAGES } from "@/lib/metadata";

type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "rules" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates(locale, "/rules"),
    openGraph: { title: t("metaTitle"), description: t("metaDescription"), images: OG_IMAGES },
    twitter: { title: t("metaTitle"), description: t("metaDescription") },
  };
}
export default async function RulesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("rules");
  const landing = await getTranslations("landing");
  return (
    <div className={styles.site}>
      <PublicHeader pathname="/rules" />
      <article className={styles.rulebook}>
        <header className={styles.rulesIntro}>
          <p className={styles.eyebrow}>{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </header>
        <section>
          <h2>{t("setupTitle")}</h2>
          <p>{t("setupBody")}</p>
        </section>
        <section>
          <h2>{t("turnTitle")}</h2>
          <p>{t("turnBody")}</p>
        </section>
        <section>
          <h2>{t("jumpTitle")}</h2>
          <p>{t("jumpBody")}</p>
          <CaptureDemo />
        </section>
        <section>
          <h2>{t("chainTitle")}</h2>
          <p>{t("chainBody")}</p>
          <p>{t("confirmBody")}</p>
        </section>
        <section>
          <h2>{t("placementTitle")}</h2>
          <h3>{t("clusterTitle")}</h3>
          <p>{t("clusterBody")}</p>
          <h3>{t("borderTitle")}</h3>
          <p>{t("borderBody")}</p>
        </section>
        <section>
          <h2>{t("winTitle")}</h2>
          <p>{t("winBody")}</p>
        </section>
        <section>
          <h2>{t("nextTitle")}</h2>
          <p>{t("nextBody")}</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/tutorial">
              {landing("tutorial")} <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.textLink} href="/play">
              {landing("play")}
            </Link>
          </div>
        </section>
      </article>
      <PublicFooter />
    </div>
  );
}
