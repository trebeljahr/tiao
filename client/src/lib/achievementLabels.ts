import { useTranslations } from "next-intl";
import { getAchievementById } from "@shared";

/**
 * Localized display helpers for achievements.
 *
 * The canonical English `name` / `description` live on `AchievementDefinition`
 * in `shared/src/achievements.ts` so the server can log grants and Steamworks
 * gets a stable source. *Display* goes through next-intl: keys live under
 * `achievements.text.{id}_name` / `_desc`. When a key is missing (e.g. a
 * freshly added achievement the translations haven't caught up to yet) we
 * fall back to the English strings from the shared definition so a newly
 * added achievement doesn't render as "MISSING_KEY" in production.
 */

type TextTranslator = ReturnType<typeof useTranslations<"achievements.text">>;

// next-intl's translator types require the key to be a known literal. For
// dynamic lookups we have to step outside the typed surface; the generic
// shape is accurate at runtime.
function safeTranslate(t: TextTranslator, key: string, fallback: string): string {
  const typedT = t as unknown as {
    has: (key: string) => boolean;
    (key: string): string;
  };
  if (typedT.has(key)) return typedT(key);
  return fallback;
}

export function useAchievementName(id: string): string {
  const t = useTranslations("achievements.text");
  const fallback = getAchievementById(id)?.name ?? id;
  return safeTranslate(t, `${id}_name`, fallback);
}

export function useAchievementDescription(id: string): string {
  const t = useTranslations("achievements.text");
  const fallback = getAchievementById(id)?.description ?? "";
  return safeTranslate(t, `${id}_desc`, fallback);
}
