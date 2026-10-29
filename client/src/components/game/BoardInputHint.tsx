import { useTranslations } from "next-intl";

export function BoardInputHint({ visible }: { visible: boolean }) {
  const t = useTranslations("input");
  if (!visible) return null;
  return (
    <p className="input-hint mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
      <span className="keyboard-hint">{t("boardKeyboard")}</span>
      <span className="gamepad-hint">{t("boardGamepad")}</span>
    </p>
  );
}
