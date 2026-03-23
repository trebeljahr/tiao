import { motion } from "framer-motion";
import type { AuthResponse } from "@shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AuthDialogMode = "login" | "signup";
export type NavbarMode = "lobby" | "local" | "multiplayer" | "profile";

type NavbarProps = {
  mode: NavbarMode;
  auth: AuthResponse | null;
  navOpen: boolean;
  onToggleNav: () => void;
  onCloseNav: () => void;
  onGoLobby: () => void;
  onGoMultiplayer: () => void;
  onGoOverTheBoard: () => void;
  onGoLocal: () => void;
  onGoProfile: () => void;
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
  const isAnonymous = !auth || auth.player.kind !== "account";

  if (auth?.player.profilePicture) {
    return (
      <img
        src={auth.player.profilePicture}
        alt={auth.player.displayName}
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
      {auth.player.displayName.slice(0, 1).toUpperCase()}
    </div>
  );
}

function PlayerSummary({ auth }: { auth: AuthResponse | null }) {
  const isAnonymous = !auth || auth.player.kind !== "account";

  return (
    <div className="flex max-w-[11.5rem] items-center gap-3 rounded-full border border-[#af8e5d]/35 bg-[rgba(255,248,232,0.94)] px-2.5 py-1.5 text-left text-[#3a2818] shadow-[0_12px_26px_-20px_rgba(99,67,28,0.45)]">
      <PlayerAvatar auth={auth} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">
          {isAnonymous ? "Anonymous" : auth.player.displayName}
        </p>
        <p className="truncate text-xs text-[#6e5b48]">
          {isAnonymous ? "Not signed in" : "Account"}
        </p>
      </div>
    </div>
  );
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 text-left transition-opacity hover:opacity-90"
      aria-label="Go to lobby"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f6e8cf]/55 bg-[linear-gradient(180deg,#faefd8,#ecd4a6)] font-display text-2xl text-[#25170d] shadow-[0_14px_28px_-18px_rgba(37,23,13,0.85)]">
        跳
      </span>
      <span className="font-display text-3xl tracking-tight text-[#3a2818]">
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
  onGoLobby,
  onGoMultiplayer,
  onGoOverTheBoard,
  onGoLocal,
  onGoProfile,
  onOpenAuth,
  onLogout,
}: NavbarProps) {
  const gameMode = mode === "local" || mode === "multiplayer";
  const navItems = [
    {
      label: "Lobby",
      active: mode === "lobby",
      onClick: onGoLobby,
    },
    {
      label: "Multiplayer",
      active: mode === "multiplayer",
      onClick: onGoMultiplayer,
    },
    {
      label: "Over the Board",
      active: mode === "local",
      onClick: onGoOverTheBoard,
    },
    {
      label: "Local",
      active: false,
      onClick: onGoLocal,
    },
  ];

  const desktopNav = (
    <div className="hidden items-center gap-1 lg:flex">
      {navItems.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          size="sm"
          className={cn(
            "text-[#3a2818]",
            item.active && "bg-[rgba(255,248,232,0.78)] text-[#24170f]"
          )}
          onClick={item.onClick}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );

  const accountControls =
    auth?.player.kind === "account" ? (
      <>
        <Button variant="secondary" size="sm" onClick={onGoProfile}>
          Profile
        </Button>
        <Button variant="ghost" size="sm" className="text-[#3a2818]" onClick={onLogout}>
          Logout
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" size="sm" className="text-[#3a2818]" onClick={() => onOpenAuth("login")}>
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
      className="absolute left-0 top-0 h-full w-full max-w-sm border-r border-[#a88252]/30 bg-[linear-gradient(180deg,rgba(243,220,173,0.98),rgba(224,187,117,0.98))] px-5 py-5 text-[#362414] shadow-[0_30px_80px_-28px_rgba(95,59,21,0.48)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-4">
        <Brand onClick={() => {
          onCloseNav();
          onGoLobby();
        }} />
        {!gameMode ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-[#3a2818]"
            onClick={onCloseNav}
          >
            <HamburgerIcon open />
          </Button>
        ) : (
          <span className="h-10 w-10 shrink-0" aria-hidden="true" />
        )}
      </div>

      <div className="mt-8 space-y-3">
        {navItems.map((item) => (
          <Button
            key={item.label}
            variant={item.active ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start text-left",
              !item.active && "text-[#3a2818]"
            )}
            onClick={() => {
              onCloseNav();
              item.onClick();
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="mt-8 rounded-3xl border border-[#a88252]/25 bg-[rgba(255,248,232,0.6)] p-4">
        <div className="flex items-center gap-3">
          <PlayerAvatar auth={auth} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {auth?.player.kind === "account" ? auth.player.displayName : "Anonymous"}
            </p>
            <p className="truncate text-sm text-[#6e5b48]">
              {auth?.player.kind === "account"
                ? auth.player.email
                : "Sign in to save your profile"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {auth?.player.kind === "account" ? (
            <>
              <Button variant="secondary" className="w-full" onClick={() => {
                onCloseNav();
                onGoProfile();
              }}>
                Profile
              </Button>
              <Button variant="ghost" className="w-full justify-center text-[#3a2818]" onClick={() => {
                onCloseNav();
                onLogout();
              }}>
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="w-full justify-center text-[#3a2818]" onClick={() => {
                onCloseNav();
                onOpenAuth("login");
              }}>
                Sign in
              </Button>
              <Button className="w-full" onClick={() => {
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
      {gameMode ? (
        <button
          type="button"
          className="fixed left-3 top-3 z-[60] inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.88)] text-[#3a2818] shadow-[0_14px_28px_-18px_rgba(75,49,20,0.46)] backdrop-blur transition-colors hover:bg-[rgba(255,252,245,0.96)]"
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
              <Brand onClick={onGoLobby} />
            </div>

            {desktopNav}

            <div className="flex items-center gap-3">
              <div>
                <PlayerSummary auth={auth} />
              </div>
              <div className="hidden items-center gap-2 lg:flex">{accountControls}</div>

              <button
                type="button"
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[#af8a56]/35 bg-[rgba(255,248,232,0.75)] text-[#3a2818] transition-colors hover:bg-[rgba(255,252,245,0.9)] lg:hidden"
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
