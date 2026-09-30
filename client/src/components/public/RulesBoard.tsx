"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { InteractiveMiniBoard } from "@/components/tutorial/InteractiveMiniBoard";
import { getTutorialSteps } from "@/components/tutorial/tutorialSteps";
import styles from "./PublicSite.module.css";

export function RulesBoard() {
  const tutorial = useTranslations("tutorial");
  const t = useTranslations("rules");
  const steps = getTutorialSteps(tutorial).filter((step) => step.board);
  const [index, setIndex] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [complete, setComplete] = useState(false);
  const step = steps[index];

  function selectStep(next: number) {
    setIndex(next);
    setResetKey((key) => key + 1);
    setComplete(false);
  }

  return (
    <section className={styles.rulesExplorer} aria-labelledby="rules-board-title">
      <div className={styles.rulesBoardCopy}>
        <p className={styles.eyebrow}>{t("boardEyebrow")}</p>
        <h2 id="rules-board-title">{t("boardTitle")}</h2>
        <label className={styles.rulePicker}>
          {t("chooseRule")}
          <select value={index} onChange={(event) => selectStep(Number(event.target.value))}>
            {steps.map((item, i) => (
              <option key={item.id} value={i}>
                {i + 1}. {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.ruleDescription}>{step.description}</div>
        <div className={styles.actions}>
          <button type="button" className={styles.textLink} onClick={() => selectStep(index)}>
            {t("resetBoard")}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => selectStep((index + 1) % steps.length)}
          >
            {t("nextExample")} →
          </button>
        </div>
        <p className={styles.boardStatus} role="status">
          {complete ? t("exampleComplete") : t("boardHint")}
        </p>
      </div>
      <div className={styles.rulesBoardSurface}>
        {step.board && (
          <InteractiveMiniBoard
            key={step.id}
            config={{ ...step.board, overlayHint: undefined }}
            active
            resetKey={resetKey}
            onComplete={() => setComplete(true)}
            t={tutorial}
          />
        )}
      </div>
    </section>
  );
}
