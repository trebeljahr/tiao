"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { FiRotateCcw } from "react-icons/fi";
import { RuleExample } from "@/components/tutorial/RuleExample";
import { getRuleExample, type RuleExampleId } from "@/components/tutorial/ruleExamples";
import styles from "./PublicSite.module.css";

const descriptions = {
  place: "turnBody",
  jump: "jumpBody",
  chain: "chainBody",
  "confirm-undo": "confirmBody",
  "border-basic": "borderBody",
  "border-chain": "border-chainBody",
  "cluster-basic": "clusterBody",
  "cluster-diagonal": "cluster-diagonalBody",
  "cluster-merge": "cluster-mergeBody",
  "cluster-enemy": "cluster-enemyBody",
  "cluster-jump": "cluster-jumpBody",
} as const satisfies Record<RuleExampleId, string>;

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
  // Keep the initial board stable when resetting an example.
  const step = useMemo(() => getRuleExample(stepId, tutorial), [tutorial, stepId]);
  const [resetKey, setResetKey] = useState(0);
  const [complete, setComplete] = useState(false);

  return (
    <section className={styles.rulesExplorer} aria-labelledby={`rule-${stepId}`}>
      <div className={styles.rulesBoardCopy}>
        <h2 id={`rule-${stepId}`}>{title ?? step.title}</h2>
        <div className={styles.ruleDescription}>{children ?? <p>{t(descriptions[stepId])}</p>}</div>
      </div>
      <div className={styles.rulesBoardSurface}>
        <RuleExample
          config={step.board}
          resetKey={resetKey}
          onComplete={() => setComplete(true)}
          t={tutorial}
        />
        <div className={styles.ruleRepeatActions}>
          {complete && (
            <button
              type="button"
              className={styles.ruleRepeat}
              aria-label={t("resetBoard")}
              title={t("resetBoard")}
              onClick={() => {
                setComplete(false);
                setResetKey((key) => key + 1);
              }}
            >
              <FiRotateCcw aria-hidden="true" size={18} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
