import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import styles from "./PublicSite.module.css";

export async function PublicHeader({ pathname = "/" }: { pathname?: string }) {
  const locale = await getLocale();
  const t = await getTranslations("landing");
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Tiao">
        <span aria-hidden="true">跳</span> Tiao
      </Link>
      <nav aria-label={t("navRules")}>
        <Link href="/rules" aria-current={pathname === "/rules" ? "page" : undefined}>
          {t("navRules")}
        </Link>
        <Link href="/about" className={styles.aboutLink}>
          {t("navAbout")}
        </Link>
        <Link href="/play" className={styles.headerPlay}>
          {t("play")} <span aria-hidden="true">↗</span>
        </Link>
      </nav>
      <nav className={styles.languages} aria-label="Language">
        {(
          [
            ["en", "EN", "English"],
            ["de", "DE", "Deutsch"],
            ["es", "ES", "Español"],
          ] as const
        ).map(([lang, label, name]) => (
          <Link
            key={lang}
            href={pathname}
            locale={lang}
            hrefLang={lang}
            lang={lang}
            aria-label={name}
            aria-current={locale === lang ? "true" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export async function PublicFooter() {
  const t = await getTranslations("landing");
  return (
    <footer className={styles.footer}>
      <p>{t("credit")}</p>
      <div>
        <Link href="/about">{t("navAbout")}</Link>
        <Link href="/privacy">{t("privacy")}</Link>
        <Link href="/impressum">{t("impressum")}</Link>
      </div>
    </footer>
  );
}
