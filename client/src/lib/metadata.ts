import type { Metadata } from "next";
import { defaultLocale, type Locale, locales } from "@/i18n/routing";

// Page-level `openGraph` declarations replace (not deep-merge) the layout's,
// so every page that overrides `openGraph` must re-declare `images` or the
// share image goes missing for that URL.
// The og:image is docs/marketing/social-preview/og-wordmark.png as JPEG.
const OG_ALT = "Tiao icon and wordmark beside a board at an angle with black and white stones";
export const OG_IMAGES = [
  { url: "/og-card.jpg", width: 1200, height: 630, type: "image/jpeg", alt: OG_ALT },
];
// Page-level `twitter` declarations replace the layout's too: re-declare
// `card` and `images`, or the page falls back to a small "summary" card.
export const TWITTER_IMAGES = [{ url: "/og-card.jpg", alt: OG_ALT }];

export const SITE_URL = "https://playtiao.com";

export const NO_INDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: {
    index: false,
    follow: false,
  },
};

export const NO_INDEX_FOLLOW_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: true,
  googleBot: {
    index: false,
    follow: true,
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

/**
 * Metadata for a page baked once with the `__spa__` placeholder and served
 * for every value of its dynamic segment. It names no canonical URL, which
 * would point at the placeholder, and shares the site-wide preview image.
 */
export function placeholderRouteMetadata({
  title,
  description,
  robots,
}: {
  title: string;
  description: string;
  robots?: Metadata["robots"];
}): Metadata {
  return {
    title,
    description,
    ...(robots && { robots }),
    openGraph: { title, description, images: OG_IMAGES },
    twitter: { card: "summary_large_image", title, description, images: TWITTER_IMAGES },
  };
}
