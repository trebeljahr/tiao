import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SITE_URL } from "@/lib/metadata";
import styles from "./PublicSite.module.css";

export async function PublicHeader({ pathname = "/" }: { pathname?: string }) {
  const locale = await getLocale();
  const t = await getTranslations("landing");
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Tiao">
        <Image src="/tiao-icon.svg" alt="" width={36} height={36} /> Tiao
      </Link>
      <nav aria-label={t("navRules")}>
        <Link href="/rules" aria-current={pathname === "/rules" ? "page" : undefined}>
          {t("navRules")}
        </Link>
        <Link href="/about" className={styles.aboutLink}>
          {t("navAbout")}
        </Link>
        <Link href="/play" className={styles.headerPlay}>
          {t("play")}
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

// The docs (docs-site/) are a separate English-only site that the web export
// serves at /docs. The installed apps do not bundle them.
const isNativeApp =
  process.env.NEXT_PUBLIC_PLATFORM === "desktop" || process.env.NEXT_PUBLIC_PLATFORM === "mobile";

export async function PublicFooter() {
  const t = await getTranslations("landing");
  return (
    <footer className={styles.footer}>
      <p>
        {t.rich("credit", {
          andreas: (chunks) => (
            <Link href="/creators/andreas" className={styles.creatorLink}>
              {chunks}
            </Link>
          ),
          rico: (chunks) => (
            <Link href="/creators/rico" className={styles.creatorLink}>
              {chunks}
            </Link>
          ),
        })}
      </p>
      <div>
        <Link href="/about">{t("navAbout")}</Link>
        <Link href="/privacy">{t("privacy")}</Link>
        <Link href="/impressum">{t("impressum")}</Link>
        <a
          href={isNativeApp ? `${SITE_URL}/docs/` : "/docs/"}
          hrefLang="en"
          {...(isNativeApp && { target: "_blank", rel: "noopener noreferrer" })}
        >
          {t("docs")}
        </a>
      </div>
    </footer>
  );
}
