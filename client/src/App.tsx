import { useEffect, useState } from "react";
import type { AuthResponse } from "@shared";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthDialogMode } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createGuest,
  getCurrentPlayer,
  login,
  logoutPlayer,
  signUpWithEmail,
} from "@/lib/api";
import { isNetworkError, readableError, toastError } from "@/lib/errors";
import { SocialNotificationsProvider } from "@/lib/SocialNotificationsContext";
import { LobbySocketProvider } from "@/lib/LobbySocketContext";
import { LobbyPage } from "./pages/LobbyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LocalGamePage } from "./pages/LocalGamePage";
import { ComputerGamePage } from "./pages/ComputerGamePage";
import { MultiplayerGamePage } from "./pages/MultiplayerGamePage";
import { MatchmakingPage } from "./pages/MatchmakingPage";
import { FriendsPage } from "./pages/FriendsPage";
import { GamesPage } from "./pages/GamesPage";
import { TutorialPage } from "./pages/TutorialPage";

const ANONYMOUS_NAME = "Anonymous";

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthDialogMode>("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authDialogError, setAuthDialogError] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupDisplayName, setSignupDisplayName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  useEffect(() => {
    if (!appError) {
      return;
    }

    toastError(appError);
    setAppError(null);
  }, [appError]);

  useEffect(() => {
    if (!authDialogError) {
      return;
    }

    toastError(authDialogError);
    setAuthDialogError(null);
  }, [authDialogError]);

  useEffect(() => {
    let cancelled = false;

    async function ensureGuestAuth() {
      const guestAuth = await createGuest(ANONYMOUS_NAME);
      if (cancelled) {
        return;
      }

      setAuth(guestAuth);
      setAppError(null);
    }

    async function bootstrapAuth(retries = 5, delayMs = 800) {
      setAuthLoading(true);
      setAppError(null);

      try {
        const response = await getCurrentPlayer();
        if (cancelled) {
          return;
        }

        setAuth({
          player: response.player,
        });
        setAuthLoading(false);
        return;
      } catch (error) {
        if (cancelled) {
          return;
        }
      }

      try {
        await ensureGuestAuth();
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isNetworkError(error) && retries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          if (!cancelled) {
            return bootstrapAuth(retries - 1, delayMs * 1.5);
          }
          return;
        }

        if (isNetworkError(error)) {
          toastError(error);
        } else {
          setAppError(readableError(error));
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    void bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyAuth(nextAuth: AuthResponse) {
    setAuth(nextAuth);
    setAppError(null);
    setAuthDialogError(null);
  }

  function openAuthDialog(mode: AuthDialogMode) {
    setAuthDialogMode(mode);
    setAuthDialogError(null);
    setAuthDialogOpen(true);
  }

  async function handleLoginSubmit() {
    setAuthBusy(true);
    setAuthDialogError(null);

    try {
      const nextAuth = await login(loginEmail, loginPassword);
      applyAuth(nextAuth);
      setAuthDialogOpen(false);
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAuthDialogError(readableError(error));
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignupSubmit() {
    setAuthBusy(true);
    setAuthDialogError(null);

    try {
      const nextAuth = await signUpWithEmail(
        signupEmail,
        signupPassword,
        signupDisplayName
      );
      applyAuth(nextAuth);
      setAuthDialogOpen(false);
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAuthDialogError(readableError(error));
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setAuth(null);

    const isInGame = location.pathname.startsWith("/game/");

    try {
      await logoutPlayer();
      const guestAuth = await createGuest(ANONYMOUS_NAME);
      applyAuth(guestAuth);

      if (isInGame) {
        navigate("/", { replace: true });
      }
    } catch (error) {
      if (isNetworkError(error)) {
        toastError(error);
      } else {
        setAppError(readableError(error));
      }
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
        <div className="rounded-3xl border border-border/80 bg-card/95 px-8 py-7 text-center shadow-[0_24px_70px_-40px_rgba(52,34,19,0.55)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-black/10 bg-[linear-gradient(180deg,#faf0da,#ecd4a7)] font-display text-4xl text-[#24160d] shadow-[0_18px_30px_-22px_rgba(36,22,13,0.85)]">
            跳
          </div>
          <p className="mt-4 font-display text-3xl">Opening Tiao</p>
          <p className="mt-2 text-sm text-muted-foreground">Preparing the board.</p>
        </div>
      </div>
    );
  }

  return (
    <LobbySocketProvider auth={auth}>
    <SocialNotificationsProvider auth={auth}>
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen">
        <Routes>
          <Route
            path="/"
            element={
              <LobbyPage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/local"
            element={
              <LocalGamePage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/computer"
            element={
              <ComputerGamePage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/game/:gameId"
            element={
              <MultiplayerGamePage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/matchmaking"
            element={
              <MatchmakingPage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/friends"
            element={
              <FriendsPage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/games"
            element={
              <GamesPage
                auth={auth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
          <Route
            path="/tutorial"
            element={
              <TutorialPage
                auth={auth}
                onAuthChange={applyAuth}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProfilePage
                auth={auth}
                onAuthChange={applyAuth}
                onOpenAuth={openAuthDialog}
                onLogout={handleLogout}
              />
            }
          />
        </Routes>
      </main>

      <Dialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        title={authDialogMode === "login" ? "Sign in" : "Create account"}
        description="Sign in or create an account to save your profile."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["login", "signup"] as AuthDialogMode[]).map((item) => (
              <Button
                key={item}
                type="button"
                variant={authDialogMode === item ? "default" : "outline"}
                onClick={() => {
                  setAuthDialogMode(item);
                  setAuthDialogError(null);
                }}
              >
                {item === "signup"
                  ? "Sign up"
                  : item === "login"
                  ? "Sign in"
                  : null}
              </Button>
            ))}
          </div>

          {authDialogMode === "login" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleLoginSubmit();
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <label
                  htmlFor="login-email"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  Username or Email
                </label>
                <Input
                  id="login-email"
                  name="identifier"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="name or name@example.com"
                  autoComplete="username email"
                  required
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="login-password"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  Password
                </label>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={authBusy}
              >
                {authBusy ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          ) : null}

          {authDialogMode === "signup" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSignupSubmit();
              }}
              className="space-y-3"
            >
              <div className="space-y-1">
                <label
                  htmlFor="signup-display-name"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  Username
                </label>
                <Input
                  id="signup-display-name"
                  name="name"
                  value={signupDisplayName}
                  onChange={(event) => setSignupDisplayName(event.target.value)}
                  placeholder="Username"
                  autoComplete="name"
                  required
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="signup-email"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  Email (Optional)
                </label>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="signup-password"
                  className="text-xs font-semibold uppercase tracking-wider text-[#7b6550]"
                >
                  Password
                </label>
                <Input
                  id="signup-password"
                  name="password"
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={authBusy}
              >
                {authBusy ? "Creating..." : "Create account"}
              </Button>
            </form>
          ) : null}
        </div>
      </Dialog>

      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          style: {
            background: "rgba(54, 37, 21, 0.96)",
            color: "#fff7ec",
            border: "1px solid rgba(246, 228, 197, 0.2)",
          },
        }}
      />
    </div>
    </SocialNotificationsProvider>
    </LobbySocketProvider>
  );
}
