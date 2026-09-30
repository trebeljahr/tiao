"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { HERO_FRAMES } from "./heroGame";
import styles from "./PublicSite.module.css";

/** A looping example game, with manual stepping for reduced motion. */
export function BoardIllustration({ title }: { title: string }) {
  const t = useTranslations("landing");
  const [index, setIndex] = useState(8);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(true);
  const frame = HERO_FRAMES[index];
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    const visibility = () => setVisible(!document.hidden);
    update();
    if (!preference.matches) setIndex(0);
    visibility();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (paused || reducedMotion || !visible) return;
    const timer = window.setTimeout(() => setIndex((index + 1) % HERO_FRAMES.length), frame.hold);
    return () => window.clearTimeout(timer);
  }, [paused, reducedMotion, visible, frame.hold, index]);
  return (
    <figure className={styles.heroReplay}>
      <svg viewBox="0 0 660 660" role="img" aria-label={title}>
        <title>{title}</title>
        <defs>
          <linearGradient id="hero-wood" x2="1" y2="1">
            <stop stopColor="#ead0a0" />
            <stop offset="1" stopColor="#c49a61" />
          </linearGradient>
          <radialGradient id="hero-white" cx="35%" cy="25%" r="75%">
            <stop stopColor="#fffdf5" />
            <stop offset="0.65" stopColor="#eee8d8" />
            <stop offset="1" stopColor="#bcb3a0" />
          </radialGradient>
          <radialGradient id="hero-black" cx="35%" cy="25%" r="75%">
            <stop stopColor="#555047" />
            <stop offset="0.6" stopColor="#29261f" />
            <stop offset="1" stopColor="#12120f" />
          </radialGradient>
          <filter id="hero-shadow" x="-30%" y="-30%" width="180%" height="180%">
            <feDropShadow dx="2" dy="4" stdDeviation="2.5" floodOpacity="0.25" />
          </filter>
        </defs>
        <rect x="8" y="8" width="644" height="644" rx="5" fill="url(#hero-wood)" />
        <g stroke="#705330" strokeWidth="0.9" opacity="0.65">
          {Array.from({ length: 19 }, (_, n) => 42 + n * 32).map((p) => (
            <g key={p}>
              <path d={`M42 ${p}H618`} />
              <path d={`M${p} 42V618`} />
            </g>
          ))}
        </g>
        {[3, 9, 15].flatMap((x) =>
          [3, 9, 15].map((y) => (
            <circle key={`${x}-${y}`} cx={42 + x * 32} cy={42 + y * 32} r="3.3" fill="#705330" />
          )),
        )}
        {frame.move && (
          <path
            d={`M${42 + frame.move.from[0] * 32} ${42 + frame.move.from[1] * 32}L${42 + frame.move.to[0] * 32} ${42 + frame.move.to[1] * 32}`}
            fill="none"
            stroke="#943d2b"
            strokeWidth="2.5"
            strokeDasharray="5 6"
          />
        )}
        {frame.stones.map(({ id, x, y, color, captured }) => (
          <g
            key={id}
            className={styles.replayStone}
            style={{
              transform: `translate(${42 + x * 32}px, ${42 + y * 32}px)`,
              opacity: captured ? 0.4 : 1,
            }}
          >
            <circle r="14.5" fill={`url(#hero-${color})`} filter="url(#hero-shadow)" />
            {captured && (
              <path
                d="M-5 -5L5 5M-5 5L5 -5"
                stroke={color === "white" ? "#943d2b" : "#fffaf0"}
                strokeWidth="2"
              />
            )}
          </g>
        ))}
      </svg>
      <figcaption className={styles.replayCaption}>
        <span>
          {t("replayLabel")} · {t(frame.turn === "white" ? "whiteTurn" : "blackTurn")}
        </span>
        <span>{t("captureScore", { white: frame.score[0], black: frame.score[1] })}</span>
        {reducedMotion ? (
          <button
            type="button"
            onClick={() => setIndex((current) => (current + 1) % HERO_FRAMES.length)}
          >
            {t("nextMove")}
          </button>
        ) : (
          <button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {t(paused ? "resumeReplay" : "pauseReplay")}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
