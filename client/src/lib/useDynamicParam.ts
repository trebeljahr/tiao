"use client";

import { usePathname } from "next/navigation";
import { resolveDynamicParam } from "./desktopPathParam";

/**
 * Hook form of {@link resolveDynamicParam} that reads the router's
 * pathname, so the value follows client-side navigation between two
 * placeholder-backed pages (for example from one game to another).
 * Kept apart from `desktopPathParam.ts`, which server page files import.
 */
export function useDynamicParam(
  prefixSegment: string,
  bakeTimeValue: string | undefined,
): string | undefined {
  const pathname = usePathname();
  return resolveDynamicParam(prefixSegment, bakeTimeValue, pathname);
}
