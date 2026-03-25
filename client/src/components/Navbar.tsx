import { motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSocialNotifications } from "@/lib/SocialNotificationsContext";

export type AuthDialogMode = "login" | "signup";
export type NavbarMode = "lobby" | "local" | "computer" | "multiplayer";

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

function PlayerAvatar({ auth }: { auth: AuthResponse | null }) {
  const player = auth?.player;
  const isAnonymous = player?.kind !== "account";

  if (player?.profilePicture) {
    return (
      <img
        src={player.profilePicture}
        alt={player.displayName}
        className="h-10 w-10 rounded-full border border-black/10 object-cover shadow-sm"
      />
    );
  }

  if (isAnonymous) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#a37d48]/35 bg-[linear-gradient(180deg,#fbf2dd,#edd7ac)] text-[#594125] shadow-sm">
        <span className="relative block h-6 w-6">
          <span className="absolute left-1/2 top-[2px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-current" />
          <span className="absolute bottom-[2px] left-1/2 h-3.5 w-5 -translate-x-1/2 rounded-t-full border border-current border-b-0" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#a37d48]/35 bg-[linear-gradient(180deg,#f4ecde,#e1cda9)] font-display text-lg text-[#2e2217] shadow-sm">
      {player.displayName.slice(0, 1).toUpperCase()}
    </div>
  );
}

function PlayerSummary({ auth }: { auth: AuthResponse | null }) {
  const player = auth?.player;
  const isAnonymous = player?.kind !== "account";

  return (
    <div className="flex max-w-[11.5rem] items-center gap-3 rounded-full border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.94)] px-2.5 py-1.5 text-left text-[#28170e] shadow-[0_12px_26px_-20px_rgba(99,67,28,0.45)]">
      <PlayerAvatar auth={auth} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {isAnonymous ? "Anonymous" : player.displayName}
        </p>
        <p className="truncate text-xs text-[#6e5b48]">
          {isAnonymous ? "Not signed in" : "Account"}
        </p>
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center text-left transition-opacity hover:opacity-90",
        compact ? "gap-2.5" : "gap-3",
        className
      )}
      aria-label="Go to lobby"
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
  const navigate = useNavigate();
  const location = useLocation();
  const { pendingFriendRequestCount, incomingInvitationCount } = useSocialNotifications();
  const player = auth?.player;
  const isAccount = player?.kind === "account";
  const gameMode =
    mode === "local" || mode === "computer" || mode === "multiplayer";
  const minimalMode = gameMode || mode === "lobby";
  const navItemClasses =
    "w-full justify-start px-3 text-left text-[#28170e] hover:bg-[rgba(255,251,241,0.94)] hover:text-[#1f120b]";
  const activeNavItemClasses =
    "bg-[rgba(255,248,232,0.94)] text-[#28170e] shadow-[0_12px_26px_-20px_rgba(98,68,31,0.38)] hover:translate-y-0 hover:bg-[rgba(255,248,232,0.94)] active:translate-y-0";

  const handleNav = (path: string) => {
    onCloseNav();
    navigate(path);
  };

  const navItems = [
    {
      label: "Lobby",
      active: location.pathname === "/",
      onClick: () => handleNav("/"),
      badge: incomingInvitationCount,
    },
    {
      label: "Over the Board",
      active: location.pathname === "/local",
      onClick: () => handleNav("/local"),
      badge: 0,
    },
    ...(location.pathname.startsWith("/game/")
      ? [
          {
            label: "Multiplayer",
            active: true,
            onClick: () => {},
            badge: 0,
          },
        ]
      : []),
    {
      label: "Against computer",
      active: location.pathname === "/computer",
      onClick: () => handleNav("/computer"),
      badge: 0,
    },
    ...(isAccount
      ? [
          {
            label: "Friends",
            active: location.pathname === "/friends",
            onClick: () => handleNav("/friends"),
            badge: pendingFriendRequestCount,
          },
          {
            label: "My Games",
            active: location.pathname === "/games",
            onClick: () => handleNav("/games"),
            badge: 0,
          },
        ]
      : []),
    {
      label: "Tutorial",
      active: location.pathname === "/tutorial",
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
          disabled={item.active}
          className={cn(
            "relative justify-start px-3 text-[#28170e] disabled:opacity-100 disabled:text-[#28170e]",
            item.active ? activeNavItemClasses : navItemClasses
          )}
          onClick={item.onClick}
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
          Profile
        </Button>
        <Button variant="ghost" size="sm" className="text-[#28170e]" onClick={onLogout}>
          Logout
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="sm" className="text-[#28170e]" onClick={() => onOpenAuth("login")}>
          Sign in
        </Button>
        <Button size="sm" onClick={() => onOpenAuth("signup")}>
          Sign up
        </Button>
      </>
    );

  const drawerContent = (
    <motion.aside
      initial={false}
      animate={{ x: navOpen ? 0 : -36, opacity: navOpen ? 1 : 0 }}
      transition={navMotionTransition}
      className="absolute left-0 top-0 h-full w-full max-w-[18.75rem] border-r border-[#b69261]/24 bg-[linear-gradient(180deg,rgba(251,238,210,0.985),rgba(239,213,161,0.975))] px-4 py-3 text-[#2b1a10] shadow-[0_30px_80px_-28px_rgba(95,59,21,0.34)] lg:max-w-[16.4rem] lg:px-3.5"
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
            disabled={item.active}
            className={cn(
              navItemClasses,
              "disabled:opacity-100 disabled:text-[#28170e]",
              item.active && activeNavItemClasses
            )}
            onClick={item.onClick}
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
          <PlayerAvatar auth={auth} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {player?.kind === "account" ? player.displayName : "Anonymous"}
            </p>
            <p className="truncate text-sm text-[#6e5b48]">
              {player?.kind === "account"
                ? player.email
                : "Sign in to save your profile"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {player?.kind === "account" ? (
            <>
              <Button variant="secondary" className="w-full justify-start" onClick={() => handleNav("/profile")}>
                Profile
              </Button>
              <Button variant="ghost" className="w-full justify-start text-[#28170e]" onClick={() => {
                onCloseNav();
                onLogout();
              }}>
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="w-full justify-start text-[#28170e]" onClick={() => {
                onCloseNav();
                onOpenAuth("login");
              }}>
                Sign in
              </Button>
              <Button className="w-full justify-start" onClick={() => {
                onCloseNav();
                onOpenAuth("signup");
              }}>
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>
    </motion.aside>
  );

  return (
    <>
      {minimalMode ? (
        <button
          type="button"
          className="fixed left-3 top-3 z-[60] inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.88)] text-[#28170e] shadow-[0_14px_28px_-18px_rgba(75,49,20,0.46)] backdrop-blur transition-colors hover:bg-[rgba(255,252,245,0.96)]"
          aria-label="Open navigation"
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
                aria-label="Open navigation"
                aria-expanded={navOpen}
                onClick={onToggleNav}
              >
                <HamburgerIcon open={navOpen} />
              </button>
            </div>
          </div>
        </nav>
      )}

      <motion.div
        className={cn(
          "fixed inset-0 z-50 bg-[rgba(15,11,8,0.5)] backdrop-blur-sm",
          !navOpen && "pointer-events-none"
        )}
        initial={false}
        animate={{ opacity: navOpen ? 1 : 0 }}
        transition={navMotionTransition}
        onClick={onCloseNav}
      >
        {drawerContent}
      </motion.div>
    </>
  );
}
