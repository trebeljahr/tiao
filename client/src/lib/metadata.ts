import type { Metadata } from "next";
import { defaultLocale, type Locale, locales } from "@/i18n/routing";

// Page-level `openGraph` declarations replace (not deep-merge) the layout's,
// so every page that overrides `openGraph` must re-declare `images` or the
// share image goes missing for that URL.
export const OG_IMAGES = [
  { url: "/opengraph-image", width: 1200, height: 630, alt: "Tiao online board game" },
];
export const TWITTER_IMAGES = ["/twitter-image"];

export const SITE_URL = "https://playtiao.com";

export const NO_INDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: {
    index: false,
    follow: false,
  },
};

function isLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}

function resolveLocale(locale: string): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return path.replace(/\/+$/, "") || "/";
}

export function localizedPath(locale: string, pathname = "/"): string {
  const resolvedLocale = resolveLocale(locale);
  const path = normalizePath(pathname);

  if (resolvedLocale === defaultLocale) {
    return path;
  }

  return path === "/" ? `/${resolvedLocale}` : `/${resolvedLocale}${path}`;
}

export function localizedUrl(locale: string, pathname = "/"): string {
  return new URL(localizedPath(locale, pathname), SITE_URL).toString();
}

export function localizedImagePath(locale: string, pathname: string, imageName: string): string {
  const basePath = localizedPath(locale, pathname).replace(/\/+$/, "") || "/";
  return basePath === "/" ? `/${imageName}` : `${basePath}/${imageName}`;
}

export function localizedOpenGraphImage(locale: string, pathname: string, alt: string) {
  return {
    url: localizedImagePath(locale, pathname, "opengraph-image"),
    width: 1200,
    height: 630,
    alt,
  };
}

export function languageAlternates(pathname = "/"): Record<string, string> {
  return {
    ...Object.fromEntries(locales.map((locale) => [locale, localizedUrl(locale, pathname)])),
    "x-default": localizedUrl(defaultLocale, pathname),
  };
}

export function localizedAlternates(
  locale: string,
  pathname = "/",
): NonNullable<Metadata["alternates"]> {
  return {
    canonical: localizedUrl(locale, pathname),
    languages: languageAlternates(pathname),
  };
}
