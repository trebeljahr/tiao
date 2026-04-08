import { THEMES, DEFAULT_THEME_ID, type BoardTheme } from "./boardThemes";
import { useSetBoardTheme } from "@/lib/useBoardTheme";
import { isDevFeatureEnabled } from "@/lib/featureGate";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Mini board preview rendered as a tiny visual swatch for a theme. */
export function ThemeSwatch({ theme }: { theme: BoardTheme }) {
  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded-lg border"
      style={{ background: theme.boardBg, borderColor: theme.boardBorder }}
    >
      {/* Sheen overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: theme.boardSheen }}
      />

      {/* Mini grid */}
      <svg className="absolute inset-[12%]" viewBox="0 0 40 40" aria-hidden="true">
        {/* Groove border */}
        <rect
          x="0"
          y="0"
          width="40"
          height="40"
          fill="none"
          stroke={theme.grooveStart}
          strokeWidth="0.8"
        />
        {/* Grid lines */}
        {[10, 20, 30].map((v) => (
          <g key={v}>
            <line x1="0" y1={v} x2="40" y2={v} stroke={theme.gridLineColor} strokeWidth="0.5" />
            <line x1={v} y1="0" x2={v} y2="40" stroke={theme.gridLineColor} strokeWidth="0.5" />
          </g>
        ))}
        {/* Star point */}
        <circle cx="20" cy="20" r="1.2" fill={theme.starPointColor} />
      </svg>

      {/* Mini pieces */}
      <span
        className="absolute rounded-full border"
        style={{
          width: "22%",
          height: "22%",
          left: "18%",
          top: "18%",
          borderColor: theme.blackPieceBorder,
          background: theme.blackPieceBg,
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
      <span
        className="absolute rounded-full border"
        style={{
          width: "22%",
          height: "22%",
          left: "58%",
          top: "58%",
          borderColor: theme.whitePieceBorder,
          background: theme.whitePieceBg,
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      />
    </div>
  );
}

export function ThemePicker({
  unlockedThemeIds,
  onNavigate,
}: {
  unlockedThemeIds?: string[];
  onNavigate?: () => void;
} = {}) {
  const [activeId, setTheme] = useSetBoardTheme();
  const isDev = isDevFeatureEnabled();

  // Guests and users without any purchased themes get only the default theme.
  // `unlockedThemeIds === undefined` (guest) is treated the same as `[]` (account
  // with no purchases) — not as "everything unlocked".
  const ownsTheme = (themeId: string): boolean =>
    themeId === DEFAULT_THEME_ID || (unlockedThemeIds?.includes(themeId) ?? false);

  // In production, only show owned themes. In dev, show all with locked ones greyed out.
  const themesToShow = isDev ? THEMES : THEMES.filter((t) => ownsTheme(t.id));

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground/80">Board theme</h3>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {themesToShow.map((theme) => {
          const isOwned = ownsTheme(theme.id);
          const isActive = theme.id === activeId;

          if (isOwned) {
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                className={cn(
                  "group flex flex-col items-center gap-1.5 rounded-xl p-1.5 transition-all",
                  isActive ? "bg-primary/10 ring-2 ring-primary/60" : "hover:bg-muted/60",
                )}
                aria-label={`${theme.name} board theme`}
                aria-pressed={isActive}
              >
                <ThemeSwatch theme={theme} />
                <span
                  className={cn(
                    "text-[11px] font-medium leading-tight",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {theme.name}
                </span>
              </button>
            );
          }

          // Locked theme (dev only) — greyed out swatch linking to shop
          return (
            <Link
              key={theme.id}
              href={`/shop#theme-${theme.id}`}
              onClick={onNavigate}
              aria-label={`Get ${theme.name} theme`}
              className="group flex flex-col items-center gap-1.5 rounded-xl p-1.5 opacity-40 grayscale transition-all hover:opacity-60 hover:grayscale-[50%]"
            >
              <ThemeSwatch theme={theme} />
              <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                {theme.name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
