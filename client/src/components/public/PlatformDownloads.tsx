"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import styles from "./PublicSite.module.css";

export function PlatformDownloads() {
  const t = useTranslations("landing");
  const platforms = [
    { name: "Steam", detail: "Windows · macOS · Linux", logo: "steam.svg" },
    { name: "iOS", detail: "iPhone · iPad", logo: "app-store.png" },
    { name: "Android", detail: "Google Play", logo: "google-play.svg" },
  ];

  return (
    <section className={styles.downloads} aria-labelledby="downloads-title">
      <p className={styles.eyebrow}>{t("platformsLabel")}</p>
      <h2 id="downloads-title">{t("downloadsTitle")}</h2>
      <p className={styles.downloadsIntro}>{t("downloadsIntro")}</p>
      <div className={styles.downloadButtons}>
        {platforms.map(({ name, detail, logo }) => (
          <button
            type="button"
            key={name}
            onClick={() =>
              toast(t("platformComingSoon", { platform: name }), { id: "platform-coming-soon" })
            }
          >
            <Image
              className={styles.platformLogo}
              src={`/platforms/${logo}`}
              alt=""
              width={128}
              height={48}
              unoptimized
            />
            <span className={styles.platformName}>
              <strong>{name}</strong>
              <small>{detail}</small>
            </span>
            <span className={styles.platformStatus}>{t("comingSoon")}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
