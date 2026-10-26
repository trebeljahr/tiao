"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { Locale } from "./routing";

// Split inside a client boundary: server-side imports of all three providers
// would put all dictionaries in the layout chunk. Only the selected provider
// renders, so SSR preloads its dictionary and the browser caches it by hash.
// Messages never cross the RSC boundary or repeat in exported HTML/payloads.
const providers = {
  en: dynamic(() => import("./providers/en")),
  de: dynamic(() => import("./providers/de")),
  es: dynamic(() => import("./providers/es")),
};

export function LocaleProvider({
  locale,
  ...props
}: {
  locale: Locale;
  children: ReactNode;
  now: Date;
  timeZone: string;
}) {
  const Provider = providers[locale];
  return <Provider {...props} />;
}
