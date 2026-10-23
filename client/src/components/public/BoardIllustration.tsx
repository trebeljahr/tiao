"use client";

import { useEffect, useState } from "react";
import { HERO_FRAMES, HERO_PRE_JUMP_FRAME } from "./heroGame";
import styles from "./PublicSite.module.css";

/** A looping example game, with a static pre-jump position for reduced motion. */
export function BoardIllustration({ title }: { title: string }) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(true);
  const frame = reducedMotion ? HERO_PRE_JUMP_FRAME : HERO_FRAMES[index];
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    const visibility = () => setVisible(!document.hidden);
    update();
    visibility();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (reducedMotion || !visible) return;
    const timer = window.setTimeout(() => setIndex((index + 1) % HERO_FRAMES.length), frame.hold);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, visible, frame.hold, index]);
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
          <marker
            id="hero-capture-arrow"
            viewBox="0 0 8 8"
            refX="6.2"
            refY="4"
            markerWidth="5.4"
            markerHeight="5.4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0 0L8 4L0 8L2.15 4Z" fill="#8dbc62" />
          </marker>
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
        {frame.trail?.map(({ from, to }) => {
          const dx = to[0] - from[0];
          const dy = to[1] - from[1];
          const distance = Math.hypot(dx, dy);
          const startInset = 11;
          const endInset = 14;
          const line = {
            x1: 42 + from[0] * 32 + (dx / distance) * startInset,
            y1: 42 + from[1] * 32 + (dy / distance) * startInset,
            x2: 42 + to[0] * 32 - (dx / distance) * endInset,
            y2: 42 + to[1] * 32 - (dy / distance) * endInset,
          };
          return (
            <g key={`${from.join(",")}-${to.join(",")}`} fill="none" strokeLinecap="round">
              <line {...line} stroke="#5f813d" strokeWidth="3.15" />
              <line
                {...line}
                stroke="#8dbc62"
                strokeWidth="2.45"
                markerEnd="url(#hero-capture-arrow)"
              />
            </g>
          );
        })}
        {frame.stones.map(({ id, x, y, color, captured }) => (
          <g
            key={id}
            className={styles.replayStone}
            style={{
              transform: `translate(${42 + x * 32}px, ${42 + y * 32}px)`,
              opacity: captured ? 0.55 : 1,
            }}
          >
            <circle r="14.5" fill={`url(#hero-${color})`} filter="url(#hero-shadow)" />
          </g>
        ))}
      </svg>
    </figure>
  );
}
