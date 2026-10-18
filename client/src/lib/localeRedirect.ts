import { defaultLocale, locales } from "@/i18n/routing";

/**
 * Locale negotiation for the static web export.
 *
 * Under the Node server, next-intl's middleware sent a visitor of an
 * unprefixed (English) page to `/de/...` or `/es/...` when their
 * `NEXT_LOCALE` cookie or Accept-Language preferred it, and remembered the
 * locale of every page in the cookie. Cloudflare's `_redirects` can read
 * neither, so this runs as an inline script in the document head, before
 * the page renders. The language switcher sets the cookie itself (next-intl
 * `syncLocaleCookie`), so choosing English sticks.
 *
 * The decision is a pure function so it is unit-tested; the inline script
 * embeds its source.
 */
export type LocaleDecision = { redirect?: string; cookie?: string };

export function decideLocale(
  pathname: string,
  cookieHeader: string,
  languages: readonly string[],
  supported: readonly string[],
  fallback: string,
): LocaleDecision {
  const first = pathname.split("/")[1] ?? "";
  const match = /(?:^|;\s*)NEXT_LOCALE=([^;]*)/.exec(cookieHeader);
  const cookie = match && supported.indexOf(match[1]) >= 0 ? match[1] : null;
  // A prefixed page: remember its locale, as the middleware did.
  if (first !== fallback && supported.indexOf(first) >= 0) {
    return cookie === first ? {} : { cookie: first };
  }
  let wanted = cookie;
  if (!wanted) {
    for (let i = 0; i < languages.length && !wanted; i++) {
      const primary = String(languages[i]).toLowerCase().split("-")[0];
      if (supported.indexOf(primary) >= 0) wanted = primary;
    }
  }
  if (wanted && wanted !== fallback) {
    return { redirect: pathname === "/" ? `/${wanted}` : `/${wanted}${pathname}` };
  }
  return cookie === fallback ? {} : { cookie: fallback };
}

/**
 * The inline head script. Same cookie shape as next-intl's (session cookie,
 * path `/`, SameSite=Lax). Web only: the desktop and mobile shells pick the
 * locale themselves.
 */
export const LOCALE_REDIRECT_INLINE_SCRIPT = `(function(d){try{var r=d(location.pathname,document.cookie,navigator.languages||[navigator.language||""],${JSON.stringify(locales)},${JSON.stringify(defaultLocale)});if(r.cookie)document.cookie="NEXT_LOCALE="+r.cookie+";path=/;SameSite=Lax";if(r.redirect)location.replace(r.redirect+location.search+location.hash)}catch(e){}})(${decideLocale.toString()});`;
