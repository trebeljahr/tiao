"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { deepLinkToPath, dispatchAuthDeepLink, isAuthDeepLink } from "@/lib/nativeDeepLinks";

type ListenerHandle = { remove: () => Promise<void> | void };
type CapacitorWindow = {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    Plugins?: {
      App?: {
        addListener: (
          event: "appUrlOpen",
          listener: (event: { url: string }) => void,
        ) => Promise<ListenerHandle> | ListenerHandle;
      };
    };
  };
};

/**
 * Opens deep links (`tiao://…`, `https://playtiao.com/…`) as in-app pages
 * in the Capacitor app, including the link that cold-started it. Renders
 * nothing; a no-op outside the native app. The native bridge exposes the
 * App plugin on `window.Capacitor`, so the client needs no Capacitor
 * package.
 */
export function NativeDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const capacitor = (window as unknown as CapacitorWindow).Capacitor;
    const app = capacitor?.Plugins?.App;
    if (!app || !capacitor?.isNativePlatform?.()) return;

    let handle: ListenerHandle | undefined;
    let disposed = false;
    void Promise.resolve(
      app.addListener("appUrlOpen", ({ url }) => {
        if (isAuthDeepLink(url)) {
          dispatchAuthDeepLink(url);
          return;
        }
        const path = deepLinkToPath(url, window.location.pathname);
        if (path) router.push(path);
      }),
    ).then((h) => {
      handle = h;
      if (disposed) void h.remove();
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [router]);

  return null;
}
