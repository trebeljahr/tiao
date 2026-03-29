import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "de", "es"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: true,
});
