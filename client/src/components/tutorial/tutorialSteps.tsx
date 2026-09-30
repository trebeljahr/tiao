import type React from "react";
import { getRuleExample, type StepBoardConfig } from "./ruleExamples";

export type { HintArrow, InteractionMode, StepBoardConfig } from "./ruleExamples";

export type TutorialStep = {
  id: string;
  title: string;
  description: React.ReactNode;
  board?: StepBoardConfig;
};

// --- Translation-aware step builder ---

type T = (key: string) => string;

export function getTutorialSteps(t: T): TutorialStep[] {
  return [
    // 1. Welcome (no board)
    {
      id: "welcome",
      title: t("_welcome_title"),
      description: (
        <div className="space-y-3">
          <div className="flex justify-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-4xl border-2 border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-5xl text-[#25170d] shadow-[0_24px_48px_-20px_rgba(37,23,13,0.7)]">
              跳
            </span>
          </div>
          <p className="text-center text-lg font-medium text-[#3d2c1a]">{t("_welcome_intro")}</p>
          <p className="text-center text-[#6e5b48]">{t("_welcome_details")}</p>
        </div>
      ),
    },

    getRuleExample("place", t),
    getRuleExample("jump", t),
    getRuleExample("chain", t),
    getRuleExample("confirm-undo", t),
    getRuleExample("border-basic", t),
    getRuleExample("border-chain", t),
    getRuleExample("cluster-basic", t),
    getRuleExample("cluster-diagonal", t),
    getRuleExample("cluster-merge", t),
    getRuleExample("cluster-enemy", t),
    getRuleExample("cluster-jump", t),
    // 13. You're Ready! (no board)
    {
      id: "summary",
      title: t("_summary_title"),
      description: (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#d7c39e] bg-[#fffaf3] overflow-hidden max-w-md mx-auto">
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    [t("_summary_ruleGeneral"), t("_summary_ruleGeneralDesc")],
                    [t("_summary_ruleWin"), t("_summary_ruleWinDesc")],
                    [t("_summary_rulePlace"), t("_summary_rulePlaceDesc")],
                    [t("_summary_ruleJump"), t("_summary_ruleJumpDesc")],
                    [t("_summary_ruleUndo"), t("_summary_ruleUndoDesc")],
                    [t("_summary_ruleCluster"), t("_summary_ruleClusterDesc")],
                    [t("_summary_ruleBorder"), t("_summary_ruleBorderDesc")],
                  ] as const
                ).map(([rule, desc]) => (
                  <tr key={rule} className="border-b border-[#e8dcc8] last:border-0">
                    <td className="px-3 py-2 font-semibold text-[#2b1e14] whitespace-nowrap">
                      {rule}
                    </td>
                    <td className="px-3 py-2 text-[#6e5b48]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-center text-[#6e5b48] mt-2">{t("_summary_ready")}</p>
        </div>
      ),
    },
  ];
}
