"use client";

/**
 * Universal provider chain + app shell chrome.
 *
 * Hot path notes (see commits around cold-compile optimization):
 *
 * 1. Heavy UI components that don't render on the critical path (auth
 *    modal, PWA install banner, cookie consent banner) are pulled in
 *    via `next/dynamic` so their module graphs (the Dialog + form
 *    primitives, the react-icons sub-path imports, etc.) land in
 *    separate chunks and don't bloat every route's cold compile.
 *
 * 2. The lobby-scoped provider chain (LobbySocketProvider + Social +
 *    Tournament notifications) is extracted into its own module at
 *    `./LobbyProviders.tsx` so it's a clean module boundary for
 *    Turbopack. Still mounted unconditionally here today, but the
 *    split sets up a future route-group refactor that can drop
 *    lobby providers from non-lobby routes entirely.
 *
 * 3. `@/lib/dump` (console interception for Rico's remote-dump bug
 *    report feature) used to be a module-top side-effect import. It
 *    now loads via a dynamic import inside a useEffect so Turbopack
 *    compiles it as a separate chunk instead of including it in
 *    every SSR compile of providers.tsx.
 *
 * 4. react-icons/fa barrel imports in AuthDialog.tsx are fine as-is —
 *    Next.js's `experimental.optimizePackageImports` default list
 *    includes `react-icons/*`, so Next rewrites the barrel into
 *    per-icon imports at compile time automatically.
 */

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { toastError } from "@/lib/errors";
import { getOAuthErrorMessage } from "@/lib/oauthErrors";
import { AnalyticsConsentProvider } from "@/lib/AnalyticsConsent";
import { LobbyProviders } from "./LobbyProviders";

// ─── Dynamic imports ─────────────────────────────────────────────────
//
// These three components are rendered from AppShell unconditionally,
// but their BODIES only render when some state flag says so (the auth
// dialog only when `authDialogOpen`, the banners only when the user
// hasn't dismissed them). next/dynamic lets Turbopack pull their
// module graphs into separate chunks so every route's cold compile
// doesn't have to walk the Dialog + form primitives + icon imports.
//
// ssr: false on the auth dialog so we don't ship ~15kb of form JSX
// through the server renderer when it's closed. The banners do render
// server-side so they can have the right initial position class.

const AuthDialog = dynamic(() => import("./AuthDialog").then((m) => m.AuthDialog), {
  ssr: false,
});

const PwaInstallBanner = dynamic(
  () => import("@/components/PwaInstallBanner").then((m) => ({ default: m.PwaInstallBanner })),
  { ssr: false },
);

const ConsentBanner = dynamic(
  () => import("@/components/ConsentBanner").then((m) => ({ default: m.ConsentBanner })),
  { ssr: false },
);

/**
 * Redirects SSO users who haven't chosen a valid username to /onboarding.
 * Prevents navigation away from /onboarding while needsUsername is true.
 */
function UsernameOnboardingGuard({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const needsUsername = auth?.player?.kind === "account" && auth.player.needsUsername === true;
  const isOnboardingPage = pathname?.endsWith("/onboarding") ?? false;

  useEffect(() => {
    if (needsUsername && !isOnboardingPage) {
      router.replace("/onboarding");
    }
  }, [needsUsername, isOnboardingPage, router]);

  // While redirect is pending, show nothing to avoid flash
  if (needsUsername && !isOnboardingPage) {
    return null;
  }

  return <>{children}</>;
}

function OAuthErrorHandler() {
  const tCommon = useTranslations("common");
  const router = useRouter();
  // Captured during render (not in an effect) so React Strict Mode's
  // double-invocation of the effect body doesn't wipe the error before
  // we get a chance to toast it: the first render's effect cleans the
  // URL, the second render sees an empty search string. Reading here
  // — once, during the first render — freezes the error for later.
  const pendingErrorRef = useRef<{ message: string } | null>(null);
  if (pendingErrorRef.current === null && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      const errorDescription = params.get("error_description");
      pendingErrorRef.current = {
        message: errorDescription || getOAuthErrorMessage(error, tCommon),
      };
    }
  }

  useEffect(() => {
    const pending = pendingErrorRef.current;
    if (!pending) return;
    pendingErrorRef.current = null;

    // Bounce back to the page that initiated the OAuth flow.
    //
    // `errorCallbackURL` passed to better-auth's linkSocial/signIn is only
    // honored once the OAuth state cookie has been parsed successfully. On
    // state-mismatch / `please_restart_the_process` and similar early
    // failures (e.g. a Discord "Cancel" click that invalidates the state),
    // better-auth falls back to its global `onAPIError.errorURL`, which is
    // just FRONTEND_URL (`/`). That lands the user on the homepage instead
    // of the settings/auth page they came from.
    //
    // Flows that care about returning to a specific page stash the origin
    // in sessionStorage before starting the OAuth dance; consume it here.
    if (typeof window !== "undefined") {
      try {
        const returnPath = sessionStorage.getItem("oauthLinkReturnPath");
        if (returnPath) {
          sessionStorage.removeItem("oauthLinkReturnPath");
          if (window.location.pathname !== returnPath) {
            router.replace(returnPath);
          }
        }
      } catch {
        // sessionStorage unavailable — ignore
      }
    }

    // Surface OAuth/link failures as a toast on whatever page the user
    // initiated the flow from (better-auth honors errorCallbackURL), so
    // they stay in context — e.g. inside a game modal or the settings
    // page — and can retry immediately instead of being bounced to a
    // dedicated error page.
    //
    // Defer the toast to the next tick: sonner's <Toaster> mounts in
    // the same render as this handler and its listener subscription
    // runs in a useEffect whose order relative to ours isn't
    // guaranteed. If we fire `toast.error` synchronously during mount,
    // the toast gets queued into sonner's internal state before the
    // Toaster has attached its renderer and nothing ever shows up in
    // the DOM. One tick of deferral lets the Toaster subscribe first,
    // then the toast renders as expected.
    window.setTimeout(() => toastError(pending.message), 0);

    // Clean the URL so the toast doesn't re-fire on refresh. Preserve
    // any other query params that might be in play.
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/**
 * Dynamically loads @/lib/dump on mount (client-only) so the console
 * interception + window.Dump() setup runs without putting dump.ts in
 * the module graph that every SSR compile has to walk. The dump module
 * auto-installs on first load via its own `if (typeof window !==
 * "undefined")` guard.
 */
function DumpInstaller() {
  useEffect(() => {
    void import("@/lib/dump");
  }, []);
  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LobbyProviders>
      <div className="min-h-screen bg-background text-foreground">
        <UsernameOnboardingGuard>
          <main className="min-h-screen">{children}</main>
        </UsernameOnboardingGuard>
        <AuthDialog />
        <OAuthErrorHandler />
        <ConsentBanner />
        <PwaInstallBanner />
        <DumpInstaller />
        {/* Sonner hardcodes z-index:999999999 on [data-sonner-toaster].
            Override it above dialogs (z-300) but below the mobile nav
            drawer backdrop (z-200 on the drawer, but toasts should still
            show over modals). Using z-400 keeps toasts visible over
            everything except the nav drawer overlay. */}
        <style>{`[data-sonner-toaster] { z-index: 400 !important; }`}</style>
        <Toaster
          richColors
          position="top-right"
          closeButton
          toastOptions={{
            style: {
              background: "#f5e6d0",
              color: "#4a3728",
              border: "1px solid #dbc6a2",
              boxShadow: "0 4px 16px rgba(74, 55, 40, 0.15)",
            },
            cancelButtonStyle: {
              background: "rgba(74, 55, 40, 0.1)",
              color: "#6e5b48",
              flexShrink: 0,
            },
            actionButtonStyle: {
              flexShrink: 0,
            },
          }}
        />
      </div>
    </LobbyProviders>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <AnalyticsConsentProvider>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </AnalyticsConsentProvider>
    </ErrorBoundary>
  );
}
