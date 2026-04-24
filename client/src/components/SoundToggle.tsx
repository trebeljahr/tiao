"use client";

import { useToggleSound } from "@/lib/useSoundPreference";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

export function SoundToggle() {
  const t = useTranslations("nav");
  const [enabled, toggle] = useToggleSound();

  return (
    <button
      type="button"
      onClick={toggle}
      className="relative flex h-8 w-8 items-center justify-center rounded-full text-[#6e5b48] transition-colors hover:bg-[rgba(0,0,0,0.06)] hover:text-[#28170e]"
      aria-label={enabled ? t("muteSounds") : t("unmuteSounds")}
    >
      <motion.svg
        aria-hidden="true"
        key={enabled ? "on" : "off"}
        viewBox="0 0 20 20"
        fill="none"
        className="h-[18px] w-[18px]"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
      >
        {enabled ? (
          <>
            <path
              d="M10 3.5L5.5 7H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L10 16.5V3.5Z"
              fill="currentColor"
            />
            <motion.path
              d="M13 7.5c.8.7 1.25 1.6 1.25 2.5s-.45 1.8-1.25 2.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            />
            <motion.path
              d="M15 5.5c1.4 1.2 2.25 2.8 2.25 4.5s-.85 3.3-2.25 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            />
          </>
        ) : (
          <>
            <path
              d="M10 3.5L5.5 7H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L10 16.5V3.5Z"
              fill="currentColor"
              opacity="0.5"
            />
            <motion.line
              x1="13"
              y1="7.5"
              x2="17.5"
              y2="12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.2 }}
            />
            <motion.line
              x1="17.5"
              y1="7.5"
              x2="13"
              y2="12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.2, delay: 0.1 }}
            />
          </>
        )}
      </motion.svg>
    </button>
  );
}
