"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import styles from "./PublicSite.module.css";

export function CaptureDemo() {
  const t = useTranslations("landing");
  const [step, setStep] = useState(0);
  const captions = [t("demoCaption0"), t("demoCaption1"), t("demoCaption2")];
  const labels = [t("demoBefore"), t("demoJump"), t("demoChain")];
  const positions = [
    [84, 252],
    [196, 140],
    [308, 140],
  ];
  return (
    <figure className={styles.demo}>
      <svg viewBox="0 0 392 336" role="img" aria-label={t("demoAlt")}>
        <title>{t("demoAlt")}</title>
        <g stroke="currentColor" opacity="0.22">
          {[28, 84, 140, 196, 252, 308, 364].map((p) => (
            <path key={`v${p}`} d={`M${p} 28V308`} />
          ))}
          {[28, 84, 140, 196, 252, 308].map((p) => (
            <path key={`h${p}`} d={`M28 ${p}H364`} />
          ))}
        </g>
        <path
          d="M84 252L196 140H308"
          fill="none"
          stroke="#963f2d"
          strokeWidth="2"
          strokeDasharray="5 7"
        />
        <circle cx="196" cy="140" r="22" fill="none" stroke="#963f2d" strokeWidth="1.5" />
        <circle cx="308" cy="140" r="22" fill="none" stroke="#963f2d" strokeWidth="1.5" />
        {[
          [140, 196],
          [252, 140],
        ].map(([x, y], i) => (
          <g key={x} opacity={step > i ? 0.4 : 1} className={styles.captured}>
            <circle cx={x + 2} cy={y + 4} r="23" fill="#30291c" opacity="0.15" />
            <circle cx={x} cy={y} r="23" fill="#302f2a" />
            <path
              d={`M${x - 10} ${y - 12}q10 -7 20 0`}
              fill="none"
              stroke="#747066"
              strokeWidth="2"
            />
            {step > i && (
              <path d={`M${x - 6} ${y - 6}l12 12m0 -12l-12 12`} stroke="#eee3cb" strokeWidth="2" />
            )}
          </g>
        ))}
        <g
          className={styles.movingStone}
          style={{ transform: `translate(${positions[step][0]}px, ${positions[step][1]}px)` }}
        >
          <circle cx="2" cy="4" r="23" fill="#30291c" opacity="0.15" />
          <circle r="23" fill="#fffcf0" stroke="#c9bca2" />
          <circle cy="-3" r="18" fill="#fffef7" />
        </g>
      </svg>
      <fieldset className={styles.demoControls} aria-label={t("demoLabel")}>
        {labels.map((label, index) => (
          <button
            key={label}
            type="button"
            aria-pressed={step === index}
            onClick={() => setStep(index)}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {label}
          </button>
        ))}
      </fieldset>
      <figcaption aria-live="polite">{captions[step]}</figcaption>
    </figure>
  );
}
