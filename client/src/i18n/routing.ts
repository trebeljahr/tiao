import { defineRouting } from "next-intl/routing";

export const locales = ["en", "de", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  // The web client is static files: an unprefixed URL is always English,
  // and only the language switcher changes the language. Off here too, so
  // `next dev` (middleware) behaves like production.
  localeDetection: false,
});
