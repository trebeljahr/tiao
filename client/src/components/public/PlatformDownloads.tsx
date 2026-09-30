"use client";

import { useTranslations } from "next-intl";
import { FaAndroid, FaApple, FaSteam } from "react-icons/fa";
import { toast } from "sonner";
import styles from "./PublicSite.module.css";

export function PlatformDownloads() {
  const t = useTranslations("landing");
  const platforms = [
    { name: "Steam", detail: "Windows · macOS · Linux", Icon: FaSteam, color: "#66c0f4" },
    { name: "iOS", detail: "iPhone · iPad", Icon: FaApple, color: "#ffffff" },
    { name: "Android", detail: "Google Play", Icon: FaAndroid, color: "#3ddc84" },
  ];

  return (
    <section className={styles.downloads} aria-labelledby="downloads-title">
      <p className={styles.eyebrow}>{t("platformsLabel")}</p>
      <h2 id="downloads-title">{t("downloadsTitle")}</h2>
      <p className={styles.downloadsIntro}>{t("downloadsIntro")}</p>
      <div className={styles.downloadButtons}>
        {platforms.map(({ name, detail, Icon, color }) => (
          <button
            type="button"
            key={name}
            onClick={() =>
              toast(t("platformComingSoon", { platform: name }), { id: "platform-coming-soon" })
            }
          >
            <Icon aria-hidden="true" style={{ color }} />
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
