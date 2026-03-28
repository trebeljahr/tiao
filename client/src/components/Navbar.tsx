import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSocialNotifications } from "@/lib/SocialNotificationsContext";
import { useToggleSound } from "@/lib/useSoundPreference";
import { ThemePicker } from "@/components/game/ThemePicker";
import { hasPreviewAccess } from "@/lib/featureGate";
import { PlayerOverviewAvatar } from "@/components/game/GameShared";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { useRouter as useIntlRouter, usePathname as useIntlPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export type AuthDialogMode = "login" | "signup";
export type NavbarMode = "lobby" | "local" | "computer" | "multiplayer" | "tutorial";

type NavbarProps = {
  mode: NavbarMode;
  auth: AuthResponse | null;
  navOpen: boolean;
  onToggleNav: () => void;
  onCloseNav: () => void;
  onOpenAuth: (mode: AuthDialogMode) => void;
  onLogout: () => void;
};

const navMotionTransition = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
} as const;

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <span className="relative block h-4 w-5">
      <motion.span
        className="absolute left-0 h-[2px] w-5 rounded-full bg-current"
        initial={false}
        animate={{
          top: open ? 7 : 0,
          rotate: open ? 45 : 0,
        }}
        transition={navMotionTransition}
      />
      <motion.span
        className="absolute left-0 top-[7px] h-[2px] w-5 rounded-full bg-current"
        initial={false}
        animate={{
          opacity: open ? 0 : 1,
          scaleX: open ? 0.45 : 1,
        }}
        transition={navMotionTransition}
      />
      <motion.span
        className="absolute left-0 h-[2px] w-5 rounded-full bg-current"
        initial={false}
        animate={{
          top: open ? 7 : 14,
          rotate: open ? -45 : 0,
        }}
        transition={navMotionTransition}
      />
    </span>
  );
}

function SoundToggle() {
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

const localeLabels: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
};

function LanguagePicker() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const intlRouter = useIntlRouter();
  const intlPathname = useIntlPathname();
  const [open, setOpen] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout>>();

  const handleSelect = useCallback(
    (newLocale: string) => {
      setOpen(false);
      if (newLocale !== locale) {
        intlRouter.replace(intlPathname, { locale: newLocale });
      }
    },
    [locale, intlRouter, intlPathname],
  );

  const handleBlur = useCallback(() => {
    closeTimeout.current = setTimeout(() => setOpen(false), 150);
  }, []);

  const handleFocus = useCallback(() => {
    clearTimeout(closeTimeout.current);
  }, []);

  return (
    <div className="relative" onBlur={handleBlur} onFocus={handleFocus}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[#6e5b48] transition-colors hover:bg-[rgba(0,0,0,0.06)] hover:text-[#28170e]"
        aria-label={t("changeLanguage")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="10" cy="10" rx="3.5" ry="7.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 7.5h14M3 12.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 bottom-full z-50 mb-1.5 min-w-[8.5rem] overflow-hidden rounded-xl border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.97)] py-1 shadow-[0_12px_28px_-10px_rgba(99,67,28,0.35)] backdrop-blur"
          >
            {routing.locales.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => handleSelect(loc)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  loc === locale
                    ? "bg-[rgba(175,142,93,0.14)] font-semibold text-[#28170e]"
                    : "text-[#6e5b48] hover:bg-[rgba(0,0,0,0.04)] hover:text-[#28170e]",
                )}
              >
                <span className="text-xs uppercase tracking-wider opacity-60">{loc}</span>
                <span>{localeLabels[loc] ?? loc}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayerSummary({ auth }: { auth: AuthResponse | null }) {
  const t = useTranslations("common");
  const player = auth?.player;
  const isAnonymous = player?.kind !== "account";

  return (
    <div className="flex items-center gap-1.5">
      <LanguagePicker />
      <SoundToggle />
      <div className="flex max-w-[11.5rem] items-center gap-3 rounded-full border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.94)] px-2.5 py-1.5 text-left text-[#28170e] shadow-[0_12px_26px_-20px_rgba(99,67,28,0.45)]">
        <PlayerOverviewAvatar
          player={{ displayName: player.displayName, profilePicture: player?.profilePicture }}
          anonymous={isAnonymous}
          className="h-10 w-10 border border-[#a37d48]/35 shadow-sm"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {player.displayName}
          </p>
        </div>
      </div>
    </div>
  );
}

function Brand({
  onClick,
  compact = false,
  className,
}: {
  onClick: () => void;
  compact?: boolean;
  className?: string;
}) {
  const tNav = useTranslations("nav");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center text-left transition-opacity hover:opacity-90",
        compact ? "gap-2.5" : "gap-3",
        className
      )}
      aria-label={tNav("goToLobby")}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl border border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-[#25170d] shadow-[0_14px_28px_-18px_rgba(37,23,13,0.85)]",
          compact ? "h-11 w-11 text-[1.72rem]" : "h-11 w-11 text-2xl"
        )}
      >
        跳
      </span>
      <span
        className={cn(
          "font-display tracking-tight text-[#3a2818]",
          compact ? "text-[2.05rem]" : "text-3xl"
        )}
      >
        Tiao
      </span>
    </button>
  );
}

export function Navbar({
  mode,
  auth,
  navOpen,
  onToggleNav,
  onCloseNav,
  onOpenAuth,
  onLogout,
}: NavbarProps) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const { pendingFriendRequestCount, incomingInvitationCount } = useSocialNotifications();
  const player = auth?.player;
  const isAccount = player?.kind === "account";
  const isAnonymous = player?.kind !== "account";
  const gameMode =
    mode === "local" || mode === "computer" || mode === "multiplayer" || mode === "tutorial";
  const minimalMode = gameMode || mode === "lobby";
  const navItemClasses =
    "w-full justify-start px-3 text-left text-[#28170e] hover:bg-[rgba(255,251,241,0.94)] hover:text-[#1f120b]";
  const activeNavItemClasses =
    "bg-[rgba(255,248,232,0.94)] text-[#28170e] shadow-[0_12px_26px_-20px_rgba(98,68,31,0.38)] hover:translate-y-0 hover:bg-[rgba(255,248,232,0.94)] active:translate-y-0";

  const handleNav = (path: string) => {
    onCloseNav();
    router.push(path);
  };

  const navItems = [
    {
      label: t("lobby"),
      active: pathname === "/",
      onClick: () => handleNav("/"),
      badge: incomingInvitationCount,
    },
    {
      label: t("overTheBoard"),
      active: pathname === "/local",
      onClick: () => handleNav("/local"),
      badge: 0,
    },
    ...(pathname?.startsWith("/game/")
      ? [
          {
            label: t("multiplayer"),
            active: true,
            onClick: () => {},
            badge: 0,
          },
        ]
      : []),
    {
      label: t("againstComputer"),
      active: pathname === "/computer",
      onClick: () => handleNav("/computer"),
      badge: 0,
    },
    ...(isAccount
      ? [
          {
            label: t("friends"),
            active: pathname === "/friends",
            onClick: () => handleNav("/friends"),
            badge: pendingFriendRequestCount,
          },
          {
            label: t("myGames"),
            active: pathname === "/games",
            onClick: () => handleNav("/games"),
            badge: 0,
          },
          {
            label: t("tournaments"),
            active: pathname?.startsWith("/tournament"),
            onClick: () => handleNav("/tournaments"),
            badge: 0,
          },
        ]
      : []),
    {
      label: t("tutorial"),
      active: pathname === "/tutorial",
      onClick: () => handleNav("/tutorial"),
      badge: 0,
    },
  ];

  const desktopNav = (
    <div className="hidden items-center gap-1 lg:flex">
      {navItems.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          size="sm"
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative justify-start px-3 text-[#28170e]",
            item.active
              ? cn(activeNavItemClasses, "pointer-events-none")
              : navItemClasses,
          )}
          onClick={item.active ? undefined : item.onClick}
        >
          {item.label}
          {item.badge > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c0542e] px-1 text-[0.65rem] font-bold leading-none text-white">
              {item.badge}
            </span>
          )}
        </Button>
      ))}
    </div>
  );

  const accountControls =
    player?.kind === "account" ? (
      <>
        <Button variant="secondary" size="sm" onClick={() => handleNav("/profile")}>
          {t("profile")}
        </Button>
        <Button variant="ghost" size="sm" className="text-[#28170e]" onClick={onLogout}>
          {t("logout")}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="sm" className="text-[#28170e]" onClick={() => onOpenAuth("login")}>
          {t("signIn")}
        </Button>
        <Button size="sm" onClick={() => onOpenAuth("signup")}>
          {t("signUp")}
        </Button>
      </>
    );

  const drawerContent = (
    <motion.aside
      initial={false}
      animate={{ x: navOpen ? 0 : -36, opacity: navOpen ? 1 : 0 }}
      transition={navMotionTransition}
      className="absolute left-0 top-0 h-full w-full max-w-[28rem] overflow-y-auto border-r border-[#b69261]/24 bg-[linear-gradient(180deg,rgba(251,238,210,0.985),rgba(239,213,161,0.975))] px-4 py-3 text-[#2b1a10] shadow-[0_30px_80px_-28px_rgba(95,59,21,0.34)] lg:max-w-[24.5rem] lg:px-3.5"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-center gap-4",
          minimalMode
            ? "min-h-11 pl-[4.15rem] pr-2 sm:pl-[4.2rem]"
            : "justify-between"
        )}
      >
        <Brand
          compact={gameMode}
          className={cn("shrink-0", minimalMode && "-translate-y-[2px]")}
          onClick={() => handleNav("/")}
        />
        {!minimalMode ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-[#28170e]"
            onClick={onCloseNav}
          >
            <HamburgerIcon open />
          </Button>
        ) : null}
      </div>

      <div className="mt-6 space-y-2.5 text-left">
        {navItems.map((item) => (
          <Button
            key={item.label}
            variant="ghost"
            aria-current={item.active ? "page" : undefined}
            className={cn(
              navItemClasses,
              item.active
                ? cn(activeNavItemClasses, "pointer-events-none")
                : "",
            )}
            onClick={item.active ? undefined : item.onClick}
          >
            {item.label}
            {item.badge > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c0542e] px-1 text-[0.65rem] font-bold leading-none text-white">
                {item.badge}
              </span>
            )}
          </Button>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[#b69261]/22 bg-[rgba(255,248,232,0.94)] p-4 text-left">
        <div className="flex items-center gap-3 text-left">
          <PlayerIdentityRow
            player={{ displayName: player?.displayName, profilePicture: player?.profilePicture }}
            anonymous={isAnonymous}
            avatarClassName="h-10 w-10 border border-[#a37d48]/35 shadow-sm"
            nameClassName="text-base font-semibold"
            className="min-w-0 flex-1 gap-3"
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <LanguagePicker />
          <SoundToggle />
        </div>

        <div className="mt-4 grid gap-2">
          {player?.kind === "account" ? (
            <>
              <Button variant="secondary" className="w-full justify-start" onClick={() => handleNav("/profile")}>
                {t("profile")}
              </Button>
              <Button variant="ghost" className="w-full justify-start text-[#28170e]" onClick={() => {
                onCloseNav();
                onLogout();
              }}>
                {t("logout")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="w-full justify-start text-[#28170e]" onClick={() => {
                onCloseNav();
                onOpenAuth("login");
              }}>
                {t("signIn")}
              </Button>
              <Button className="w-full justify-start" onClick={() => {
                onCloseNav();
                onOpenAuth("signup");
              }}>
                {t("signUp")}
              </Button>
            </>
          )}
        </div>
      </div>

      {hasPreviewAccess(auth) && (
        <div className="mt-5 rounded-3xl border border-[#b69261]/22 bg-[rgba(255,248,232,0.94)] p-4">
          <ThemePicker />
        </div>
      )}

      <p className="mt-4 text-center text-xs tracking-wide text-[#7a6a58]">
        v{process.env.APP_VERSION}
      </p>
    </motion.aside>
  );

  return (
    <>
      {minimalMode ? (
        <button
          type="button"
          className="fixed left-3 top-3 z-[60] inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.88)] text-[#28170e] shadow-[0_14px_28px_-18px_rgba(75,49,20,0.46)] backdrop-blur transition-colors hover:bg-[rgba(255,252,245,0.96)]"
          aria-label={t("openNavigation")}
          aria-expanded={navOpen}
          onClick={onToggleNav}
        >
          <HamburgerIcon open={navOpen} />
        </button>
      ) : (
        <nav className="sticky top-0 z-40 border-b border-[#af8a56]/35 bg-[linear-gradient(180deg,rgba(245,223,178,0.97),rgba(225,189,119,0.98))] shadow-[0_20px_40px_-28px_rgba(96,63,24,0.4)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Brand onClick={() => handleNav("/")} />
            </div>

            {desktopNav}

            <div className="flex items-center gap-3">
              <div>
                <PlayerSummary auth={auth} />
              </div>
              <div className="hidden items-center gap-2 lg:flex">{accountControls}</div>

              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.75)] text-[#28170e] transition-colors hover:bg-[rgba(255,252,245,0.9)] lg:hidden"
                aria-label={t("openNavigation")}
                aria-expanded={navOpen}
                onClick={onToggleNav}
              >
                <HamburgerIcon open={navOpen} />
              </button>
            </div>
          </div>
        </nav>
      )}

      <AnimatePresence>
        {navOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-[rgba(15,11,8,0.5)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={navMotionTransition}
            onClick={onCloseNav}
          >
            {drawerContent}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
