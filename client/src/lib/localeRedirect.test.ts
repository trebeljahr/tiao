import { describe, expect, it } from "vitest";
import { decideLocale, LOCALE_REDIRECT_INLINE_SCRIPT } from "./localeRedirect";

const LOCALES = ["en", "de", "es"];
const decide = (path: string, cookie: string, languages: string[]) =>
  decideLocale(path, cookie, languages, LOCALES, "en");

describe("decideLocale", () => {
  it("sends a first visit to the browser's preferred supported locale", () => {
    expect(decide("/", "", ["de-DE", "en"])).toEqual({ redirect: "/de" });
    expect(decide("/play", "", ["fr-FR", "es-MX"])).toEqual({ redirect: "/es/play" });
    expect(decide("/game/ABC", "", ["DE"])).toEqual({ redirect: "/de/game/ABC" });
  });

  it("keeps English and remembers it when nothing else is preferred", () => {
    expect(decide("/", "", ["en-US", "de"])).toEqual({ cookie: "en" });
    expect(decide("/play", "", ["fr", "ja"])).toEqual({ cookie: "en" });
    expect(decide("/play", "", [])).toEqual({ cookie: "en" });
    expect(decide("/play", "NEXT_LOCALE=en", ["de"])).toEqual({});
  });

  it("follows the cookie over the browser languages", () => {
    expect(decide("/rules", "a=1; NEXT_LOCALE=es; b=2", ["de"])).toEqual({
      redirect: "/es/rules",
    });
    expect(decide("/rules", "NEXT_LOCALE=en", ["de"])).toEqual({});
  });

  it("ignores an unsupported cookie value", () => {
    expect(decide("/", "NEXT_LOCALE=fr", ["de"])).toEqual({ redirect: "/de" });
    expect(decide("/", "MY_NEXT_LOCALE=de", ["en"])).toEqual({ cookie: "en" });
  });

  it("never redirects a prefixed page and remembers its locale", () => {
    expect(decide("/de", "", ["es"])).toEqual({ cookie: "de" });
    expect(decide("/es/play", "NEXT_LOCALE=de", ["de"])).toEqual({ cookie: "es" });
    expect(decide("/de/play", "NEXT_LOCALE=de", ["es"])).toEqual({});
  });
});

describe("LOCALE_REDIRECT_INLINE_SCRIPT", () => {
  function run(pathname: string, cookie: string, languages: string[]) {
    const writes: string[] = [];
    const replaced: string[] = [];
    const location = {
      pathname,
      search: "?ref=x",
      hash: "#h",
      replace: (url: string) => replaced.push(url),
    };
    const document = {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        writes.push(value);
      },
    };
    new Function("location", "document", "navigator", LOCALE_REDIRECT_INLINE_SCRIPT)(
      location,
      document,
      { languages },
    );
    return { writes, replaced };
  }

  it("redirects with the query and hash kept", () => {
    expect(run("/play", "", ["de"])).toEqual({ writes: [], replaced: ["/de/play?ref=x#h"] });
  });

  it("writes the cookie the way next-intl does", () => {
    expect(run("/es", "", ["de"])).toEqual({
      writes: ["NEXT_LOCALE=es;path=/;SameSite=Lax"],
      replaced: [],
    });
  });
});
