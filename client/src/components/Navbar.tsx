"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSocialNotifications } from "@/lib/SocialNotificationsContext";
import { useToggleSound } from "@/lib/useSoundPreference";
import { ThemePicker } from "@/components/game/ThemePicker";
import { canSeeShop } from "@/lib/featureGate";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { useRouter as useIntlRouter, usePathname as useIntlPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export type AuthDialogMode = "login" | "signup";
export type NavbarMode = "lobby" | "multiplayer" | "tutorial";

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
  const [openAbove, setOpenAbove] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev && triggerRef.current) {
        // Estimate popup height (~3 items * 36px + padding)
        const popupHeight = 130;
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenAbove(spaceBelow < popupHeight);
      }
      return !prev;
    });
  }, []);

  return (
    <div className="relative" onBlur={handleBlur} onFocus={handleFocus}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[#6e5b48] transition-colors hover:bg-[rgba(0,0,0,0.06)] hover:text-[#28170e]"
        aria-label={t("changeLanguage")}
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
          <ellipse cx="10" cy="10" rx="3.5" ry="7.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M3 7.5h14M3 12.5h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: openAbove ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: openAbove ? 6 : -6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={cn(
              "absolute right-0 z-50 min-w-34 overflow-hidden rounded-xl border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.97)] py-1 shadow-[0_12px_28px_-10px_rgba(99,67,28,0.35)] backdrop-blur-sm",
              openAbove ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
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

/**
 * Persistent player chip rendered at fixed top-right whenever the navbar is
 * in "minimal" mode (lobby / multiplayer / tutorial — i.e. every page). The
 * full sticky `<nav>` with its embedded PlayerSummary is only used in the
 * non-minimal branch, which no route currently takes, so without this pill
 * the logged-in user's rating (and name, and avatar) is completely hidden
 * until they open the drawer. Clicking the pill toggles the drawer, so it
 * pulls double-duty as a second "open navigation" affordance.
 */
function MinimalPlayerPill({ auth, onClick }: { auth: AuthResponse | null; onClick: () => void }) {
  const player = auth?.player;
  if (!player) return null;
  const isAnonymous = player.kind !== "account";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={player.displayName ?? "Player"}
      className="fixed right-3 top-3 z-60 inline-flex max-w-[min(18rem,calc(100vw-5rem))] items-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.88)] px-2.5 py-1.5 text-left text-[#28170e] shadow-[0_14px_28px_-18px_rgba(75,49,20,0.46)] backdrop-blur-sm transition-colors hover:bg-[rgba(255,252,245,0.96)]"
    >
      <PlayerIdentityRow
        player={{
          displayName: player.displayName,
          profilePicture: player.profilePicture,
          activeBadges: player.activeBadges,
          rating: isAnonymous ? undefined : (player.rating ?? 1500),
        }}
        anonymous={isAnonymous}
        linkToProfile={false}
        avatarClassName="h-8 w-8 border border-[#a37d48]/35 shadow-xs"
        nameClassName="text-sm font-semibold"
        friendVariant="light"
        className="min-w-0 gap-2.5"
      />
    </button>
  );
}

function PlayerSummary({ auth }: { auth: AuthResponse | null }) {
  const player = auth?.player;
  const isAnonymous = player?.kind !== "account";

  return (
    <div className="flex items-center gap-1.5">
      <LanguagePicker />
      <SoundToggle />
      <div className="max-w-56 rounded-full border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.94)] px-2.5 py-1.5 text-left text-[#28170e] shadow-[0_12px_26px_-20px_rgba(99,67,28,0.45)]">
        <PlayerIdentityRow
          player={{
            displayName: player?.displayName ?? "Guest",
            profilePicture: player?.profilePicture,
            activeBadges: player?.activeBadges,
            rating: isAnonymous ? undefined : (player?.rating ?? 1500),
          }}
          anonymous={isAnonymous}
          linkToProfile={false}
          avatarClassName="h-10 w-10 border border-[#a37d48]/35 shadow-xs"
          nameClassName="text-sm font-semibold"
          friendVariant="light"
          className="gap-3"
        />
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
        className,
      )}
      aria-label={tNav("goToLobby")}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-2xl border border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-[#25170d] shadow-[0_14px_28px_-18px_rgba(37,23,13,0.85)]",
          compact ? "h-11 w-11 text-[1.72rem]" : "h-11 w-11 text-2xl",
        )}
      >
        跳
      </span>
      <span
        className={cn(
          "font-display tracking-tight text-[#3a2818]",
          compact ? "text-[2.05rem]" : "text-3xl",
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
  const intlRouter = useIntlRouter();
  const pathname = useIntlPathname();
  const {
    unacknowledgedFriendRequestCount,
    unacknowledgedInvitationCount,
    unacknowledgedRematchCount,
  } = useSocialNotifications();
  const player = auth?.player;
  const isAccount = player?.kind === "account";
  const isAnonymous = player?.kind !== "account";
  const gameMode = mode === "multiplayer" || mode === "tutorial";
  const minimalMode = gameMode || mode === "lobby";
  const navItemClasses =
    "w-full justify-start px-3 text-left text-[#28170e] hover:bg-[rgba(255,251,241,0.94)] hover:text-[#1f120b]";
  const activeNavItemClasses =
    "bg-[rgba(255,248,232,0.94)] text-[#28170e] shadow-[0_12px_26px_-20px_rgba(98,68,31,0.38)] hover:translate-y-0 hover:bg-[rgba(255,248,232,0.94)] active:translate-y-0";

  const handleNav = (path: string) => {
    onCloseNav();
    intlRouter.push(path);
  };

  const iconClass = "mr-1.5 h-3.5 w-3.5 shrink-0 translate-y-[1px]";
  const iconProps = {
    className: iconClass,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
  } as const;
  const pathProps = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

  // Click handler for the red notification badge: scrolls the destination
  // page to the relevant section, wiggles it, and marks the items as
  // acknowledged. Implemented in LobbyPage / FriendsPage via a hashchange
  // listener; here we just navigate with the right URL hash.
  type NavItem = {
    label: string;
    active: boolean;
    onClick: () => void;
    badge: number;
    badgeTarget?: string;
    icon: React.ReactNode;
  };
  const navItems: NavItem[] = [
    {
      label: t("lobby"),
      active: pathname === "/",
      onClick: () => handleNav("/"),
      badge: unacknowledgedInvitationCount + unacknowledgedRematchCount,
      badgeTarget: "/#invitations",
      icon: (
        <svg {...iconProps}>
          <path {...pathProps} d="M3 12l9-8 9 8" />
          <path {...pathProps} d="M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9" />
        </svg>
      ),
    },
    ...(isAccount
      ? [
          {
            label: t("friends"),
            active: pathname === "/friends",
            onClick: () => handleNav("/friends"),
            badge: unacknowledgedFriendRequestCount,
            badgeTarget: "/friends#incoming-friend-requests",
            icon: (
              <svg {...iconProps}>
                <circle {...pathProps} cx="9" cy="7" r="3" />
                <path {...pathProps} d="M3 21v-1a5 5 0 015-5h2a5 5 0 015 5v1" />
                <circle {...pathProps} cx="17" cy="8" r="2.5" />
                <path {...pathProps} d="M21 21v-.5a4 4 0 00-3-3.87" />
              </svg>
            ),
          },
          {
            label: t("myGames"),
            active: pathname === "/games",
            onClick: () => handleNav("/games"),
            badge: 0,
            icon: (
              <svg {...iconProps}>
                <rect {...pathProps} x="3" y="3" width="18" height="18" rx="2" />
                <path {...pathProps} d="M3 12h18M12 3v18M3 7.5h18M3 16.5h18M7.5 3v18M16.5 3v18" />
              </svg>
            ),
          },
          {
            label: t("tournaments"),
            active: pathname?.startsWith("/tournament"),
            onClick: () => handleNav("/tournaments"),
            badge: 0,
            icon: (
              <svg {...iconProps}>
                <path {...pathProps} d="M5 14c0-3.9 3.1-7 7-7s7 3.1 7 7" />
                <path {...pathProps} d="M4 14h16" />
                <path {...pathProps} d="M5 14v3h14v-3" />
                <path {...pathProps} d="M9 17v2M15 17v2" />
                <path {...pathProps} d="M5 12c-2-3-3-7-1-10M19 12c2-3 3-7 1-10" />
              </svg>
            ),
          },
          {
            label: t("achievements"),
            active: pathname === "/achievements",
            onClick: () => handleNav("/achievements"),
            badge: 0,
            icon: (
              <svg {...iconProps}>
                <path
                  {...pathProps}
                  d="M6 9V2h12v7a6 6 0 01-12 0zM6 4H4a1 1 0 00-1 1v1a4 4 0 004 4M18 4h2a1 1 0 011 1v1a4 4 0 01-4 4M9 21h6M12 15v6"
                />
              </svg>
            ),
          },
        ]
      : []),
    ...(canSeeShop(auth)
      ? [
          {
            label: t("shop"),
            active: pathname === "/shop",
            onClick: () => handleNav("/shop"),
            badge: 0,
            icon: (
              <svg {...iconProps}>
                <path {...pathProps} d="M6 2L3 7h18l-3-5H6z" />
                <path {...pathProps} d="M3 7v12a2 2 0 002 2h14a2 2 0 002-2V7" />
                <path {...pathProps} d="M9 11a3 3 0 006 0" />
              </svg>
            ),
          },
        ]
      : []),
    {
      label: t("tutorial"),
      active: pathname === "/tutorial",
      onClick: () => handleNav("/tutorial"),
      badge: 0,
      icon: (
        <svg {...iconProps}>
          <path {...pathProps} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
          <path {...pathProps} d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
      ),
    },
  ];

  const handleBadgeClick = (
    event: React.MouseEvent | React.KeyboardEvent,
    target: string | undefined,
  ) => {
    if (!target) return;
    event.stopPropagation();
    // Strip the hash so handleNav routes through next-intl, then re-apply
    // it via window.location so the hashchange listener on the destination
    // page picks it up even when we're already on that route.
    const [path, hash] = target.split("#");
    onCloseNav();
    if (pathname === path) {
      // Already on the destination page — set the hash so the page's
      // hashchange listener fires and scrolls + wiggles + acknowledges.
      // Replace any existing hash first so re-clicks still trigger.
      if (typeof window !== "undefined") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        window.location.hash = `#${hash}`;
      }
    } else {
      intlRouter.push(`${path}#${hash}`);
    }
  };

  const renderBadge = (item: NavItem) =>
    item.badge > 0 ? (
      <span
        role="button"
        tabIndex={0}
        aria-label={t("notificationBadgeAria", { label: item.label, count: item.badge })}
        onClick={(e) => handleBadgeClick(e, item.badgeTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleBadgeClick(e, item.badgeTarget);
          }
        }}
        className="pointer-events-auto ml-1.5 inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-full bg-[#c0542e] px-1 text-[0.65rem] font-bold leading-none text-white shadow-sm hover:bg-[#a8431f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c0542e]/40"
      >
        {item.badge}
      </span>
    ) : null;

  const desktopNav = (
    <div className="hidden items-center gap-1 md:flex">
      {navItems.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          size="sm"
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative justify-start px-3 text-[#28170e]",
            item.active ? cn(activeNavItemClasses, "pointer-events-none") : navItemClasses,
          )}
          onClick={item.active ? undefined : item.onClick}
        >
          {item.icon}
          {item.label}
          {renderBadge(item)}
        </Button>
      ))}
    </div>
  );

  const settingsIcon = (
    <svg {...iconProps}>
      <circle {...pathProps} cx="12" cy="12" r="3" />
      <path
        {...pathProps}
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1.08z"
      />
    </svg>
  );
  const logoutIcon = (
    <svg {...iconProps}>
      <path {...pathProps} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline {...pathProps} points="16 17 21 12 16 7" />
      <line {...pathProps} x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );

  const accountControls =
    player?.kind === "account" ? (
      <>
        <Button variant="secondary" size="sm" onClick={() => handleNav("/settings")}>
          {settingsIcon}
          {t("settings")}
        </Button>
        <Button variant="ghost" size="sm" className="text-[#28170e]" onClick={onLogout}>
          {logoutIcon}
          {t("logout")}
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="text-[#28170e]"
          onClick={() => onOpenAuth("login")}
        >
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
      className="absolute left-0 top-0 h-full w-full max-w-[20.6rem] overflow-y-auto border-r border-[#b69261]/24 bg-[linear-gradient(180deg,rgba(251,238,210,0.985),rgba(239,213,161,0.975))] px-4 py-3 text-[#2b1a10] shadow-[0_30px_80px_-28px_rgba(95,59,21,0.34)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-center",
          minimalMode ? "min-h-11 pl-[4.15rem] pr-2 sm:pl-[4.2rem]" : "justify-between",
        )}
      >
        <Brand
          compact={gameMode}
          className={cn("shrink-0", minimalMode && "-translate-y-[2px]")}
          onClick={() => handleNav("/")}
        />
        <div className="ml-auto flex items-center gap-1">
          <LanguagePicker />
          <SoundToggle />
          {!minimalMode && (
            <Button variant="ghost" size="icon" className="text-[#28170e]" onClick={onCloseNav}>
              <HamburgerIcon open />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2.5 text-left">
        {navItems.map((item) => (
          <Button
            key={item.label}
            variant="ghost"
            aria-current={item.active ? "page" : undefined}
            className={cn(
              navItemClasses,
              item.active ? cn(activeNavItemClasses, "pointer-events-none") : "",
            )}
            onClick={item.active ? undefined : item.onClick}
          >
            {item.icon}
            {item.label}
            {renderBadge(item)}
          </Button>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[#b69261]/22 bg-[rgba(255,248,232,0.94)] p-4 text-left">
        <div className="flex items-center gap-3 text-left">
          <PlayerIdentityRow
            player={{
              displayName: player?.displayName,
              profilePicture: player?.profilePicture,
              activeBadges: player?.activeBadges,
              rating: isAnonymous ? undefined : (player?.rating ?? 1500),
            }}
            anonymous={isAnonymous}
            avatarClassName="h-10 w-10 border border-[#a37d48]/35 shadow-xs"
            nameClassName="text-base font-semibold"
            className="min-w-0 flex-1 gap-3"
          />
        </div>
        <div className="mt-4 grid gap-2">
          {player?.kind === "account" ? (
            <>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => handleNav("/settings")}
              >
                {settingsIcon}
                {t("settings")}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-[#28170e]"
                onClick={() => {
                  onCloseNav();
                  onLogout();
                }}
              >
                {logoutIcon}
                {t("logout")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start text-[#28170e]"
                onClick={() => {
                  onCloseNav();
                  onOpenAuth("login");
                }}
              >
                {t("signIn")}
              </Button>
              <Button
                className="w-full justify-start"
                onClick={() => {
                  onCloseNav();
                  onOpenAuth("signup");
                }}
              >
                {t("signUp")}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-[#b69261]/22 bg-[rgba(255,248,232,0.94)] p-4">
        <ThemePicker unlockedThemeIds={auth?.player.unlockedThemes} onNavigate={onCloseNav} />
      </div>

      <a
        href="https://github.com/trebeljahr/tiao/issues/new/choose"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[#7a6a58] transition-colors hover:bg-[rgba(0,0,0,0.04)] hover:text-[#28170e]"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
        </svg>
        {t("reportIssue")}
      </a>

      <p className="mt-2 text-center text-xs tracking-wide text-[#7a6a58]">
        v{process.env.APP_VERSION}
      </p>
    </motion.aside>
  );

  return (
    <>
      {minimalMode ? (
        <>
          <button
            type="button"
            className="fixed left-3 top-3 z-60 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.88)] text-[#28170e] shadow-[0_14px_28px_-18px_rgba(75,49,20,0.46)] backdrop-blur-sm transition-colors hover:bg-[rgba(255,252,245,0.96)]"
            aria-label={t("openNavigation")}
            aria-expanded={navOpen}
            onClick={onToggleNav}
          >
            <HamburgerIcon open={navOpen} />
          </button>
          <MinimalPlayerPill auth={auth} onClick={onToggleNav} />
        </>
      ) : (
        <nav className="sticky top-0 z-40 border-b border-[#af8a56]/35 bg-[linear-gradient(180deg,rgba(245,223,178,0.97),rgba(225,189,119,0.98))] shadow-[0_20px_40px_-28px_rgba(96,63,24,0.4)] backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Brand onClick={() => handleNav("/")} />
            </div>

            {desktopNav}

            <div className="flex items-center gap-3">
              <div>
                <PlayerSummary auth={auth} />
              </div>
              <div className="hidden items-center gap-2 md:flex">{accountControls}</div>

              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.75)] text-[#28170e] transition-colors hover:bg-[rgba(255,252,245,0.9)] md:hidden"
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
            className="fixed inset-0 z-50 bg-[rgba(15,11,8,0.5)] backdrop-blur-xs"
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
