"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { RuleExample } from "@/components/tutorial/RuleExample";
import { getRuleExample, type RuleExampleId } from "@/components/tutorial/ruleExamples";
import styles from "./PublicSite.module.css";

export function RuleSection({
  stepId,
  title,
  children,
}: {
  stepId: RuleExampleId;
  title?: string;
  children?: ReactNode;
}) {
  const tutorial = useTranslations("tutorial");
  const t = useTranslations("rules");
  // Keep the initial board stable when completion or reset state changes.
  const step = useMemo(() => getRuleExample(stepId, tutorial), [tutorial, stepId]);
  const [resetKey, setResetKey] = useState(0);
  const [complete, setComplete] = useState(false);

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
        <RuleExample
          config={step.board}
          resetKey={resetKey}
          onComplete={() => setComplete(true)}
          t={tutorial}
        />
      </div>
    </section>
  );
}
