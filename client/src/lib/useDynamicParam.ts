"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { resolveDynamicParam } from "./desktopPathParam";

const subscribeNothing = () => () => {};

/**
 * Hook form of {@link resolveDynamicParam} that reads the router's
 * pathname, so the value follows client-side navigation between two
 * placeholder-backed pages (for example from one game to another).
 * Kept apart from `desktopPathParam.ts`, which server page files import.
 *
 * During hydration it returns what the pre-rendered HTML was built with
 * (no value for a placeholder page) and the real value from the next
 * render on. React keeps server-rendered attributes it finds mismatched
 * while hydrating, so rendering the URL's value at once would leave, for
 * example, a link built from the placeholder in the DOM.
 */
export function useDynamicParam(
  prefixSegment: string,
  bakeTimeValue: string | undefined,
): string | undefined {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  return resolveDynamicParam(prefixSegment, bakeTimeValue, hydrated ? pathname : "");
}
