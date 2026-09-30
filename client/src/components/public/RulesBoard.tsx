"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { InteractiveMiniBoard } from "@/components/tutorial/InteractiveMiniBoard";
import { getTutorialSteps } from "@/components/tutorial/tutorialSteps";
import styles from "./PublicSite.module.css";

export function RulesBoard({
  stepId,
  title,
  children,
}: {
  stepId: string;
  title?: string;
  children?: ReactNode;
}) {
  const tutorial = useTranslations("tutorial");
  const t = useTranslations("rules");
  // Keep the initial board stable when completion or reset state changes.
  const step = useMemo(
    () => getTutorialSteps(tutorial).find((item) => item.id === stepId),
    [tutorial, stepId],
  );
  const [resetKey, setResetKey] = useState(0);
  const [complete, setComplete] = useState(false);
  if (!step?.board) return null;

  return (
    <section className={styles.rulesExplorer} aria-labelledby={`rule-${stepId}`}>
      <div className={styles.rulesBoardCopy}>
        <h2 id={`rule-${stepId}`}>{title ?? step.title}</h2>
        {children}
        <div className={styles.ruleDescription}>{step.description}</div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.textLink}
            onClick={() => {
              setResetKey((key) => key + 1);
              setComplete(false);
            }}
          >
            {t("resetBoard")}
          </button>
        </div>
        <p className={styles.boardStatus} role="status">
          {complete ? t("exampleComplete") : t("boardHint")}
        </p>
      </div>
      <div className={styles.rulesBoardSurface}>
        <InteractiveMiniBoard
          config={{ ...step.board, overlayHint: undefined }}
          active
          resetKey={resetKey}
          onComplete={() => setComplete(true)}
          t={tutorial}
        />
      </div>
    </section>
  );
}
