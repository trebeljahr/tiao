import { locales } from "@/i18n/routing";

/** Public pages need session detection, but no guest creation or live lobby. */
export function isPublicInfoPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (locales.some((locale) => locale === segments[0])) segments.shift();
  return segments.length === 0 || (segments.length === 1 && segments[0] === "rules");
}
