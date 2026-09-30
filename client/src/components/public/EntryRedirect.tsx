"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/AuthContext";

/** Leave public HTML visible to visitors while the existing session is verified. */
export function EntryRedirect() {
  const { auth, authBootstrapped } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const desktop = (window as Window & { electron?: { isElectron?: boolean } }).electron
      ?.isElectron;
    // Old notification links pointed to /#invitations. Keep those bookmarks useful.
    const invitation = window.location.hash === "#invitations";
    const signedIn = authBootstrapped && auth?.player.kind === "account";
    // The app's onboarding guard owns incomplete account setup.
    if (signedIn && auth.player.needsUsername) return;
    if (desktop || invitation || signedIn) {
      router.replace(`/play${window.location.search}${window.location.hash}`);
    }
  }, [auth, authBootstrapped, router]);

  return null;
}
