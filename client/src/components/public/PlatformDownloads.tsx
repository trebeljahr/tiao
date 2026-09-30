"use client";

import { useTranslations } from "next-intl";
import { FaAndroid, FaApple, FaSteam } from "react-icons/fa";
import { toast } from "sonner";
import styles from "./PublicSite.module.css";

export function PlatformDownloads() {
  const t = useTranslations("landing");
  const platforms = [
    { name: "Steam", detail: "Windows · macOS · Linux", Icon: FaSteam },
    { name: "iOS", detail: "iPhone · iPad", Icon: FaApple },
    { name: "Android", detail: "Google Play", Icon: FaAndroid },
  ];

  return (
    <section className={styles.downloads} aria-labelledby="downloads-title">
      <p className={styles.eyebrow}>{t("platformsLabel")}</p>
      <h2 id="downloads-title">{t("downloadsTitle")}</h2>
      <p className={styles.downloadsIntro}>{t("downloadsIntro")}</p>
      <div className={styles.downloadButtons}>
        {platforms.map(({ name, detail, Icon }) => (
          <button
            type="button"
            key={name}
            onClick={() =>
              toast(t("platformComingSoon", { platform: name }), { id: "platform-coming-soon" })
            }
          >
            <Icon aria-hidden="true" />
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
