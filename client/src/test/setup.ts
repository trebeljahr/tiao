import "@testing-library/jest-dom";
import { vi } from "vitest";
import enMessages from "../../messages/en.json";

// jsdom doesn't implement window.scrollTo (nor Element.scrollTo), so any
// component that calls it during mount — e.g. MultiplayerGamePage's
// "both seated" effect — floods test logs with:
//   Error: Not implemented: window.scrollTo
// Stub both to no-ops. Tests that care about scroll behavior should
// explicitly spy/assert on these.
if (typeof window !== "undefined") {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
}

// Mock next/navigation — must be in setup so it's available before next-intl resolves it
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useSelectedLayoutSegment: () => null,
  useSelectedLayoutSegments: () => [],
}));

// Mock @/i18n/navigation — provides locale-aware navigation hooks used by Navbar
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  Link: "a",
  redirect: vi.fn(),
}));

// Mock next-intl — return actual English translations so tests can match rendered text
vi.mock("next-intl", () => {
  const messages = enMessages as unknown as Record<string, unknown>;

  /**
   * Walks a dotted namespace path ("achievements.text") into the message tree.
   * Returns the object at that path, or an empty record if any segment is
   * missing / not an object.
   */
  const resolveNamespace = (namespace: string): Record<string, string> => {
    const segments = namespace.split(".");
    let cursor: unknown = messages;
    for (const segment of segments) {
      if (cursor && typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>)[segment];
      } else {
        return {};
      }
    }
    return (cursor ?? {}) as Record<string, string>;
  };

  // Cache the `t` function per namespace so repeated `useTranslations("ns")`
  // calls from the same component across renders return a STABLE function
  // identity. Without this, components that use `t` inside `useCallback` /
  // `useMemo` deps see a fresh identity on every render, invalidating their
  // memoization and, in providers with async effects (e.g.
  // SocialNotificationsContext), causing the init effect to re-run on every
  // render and fire state updates outside the test's act boundary — which
  // floods stderr with "An update to <Provider> inside a test was not
  // wrapped in act(...)" warnings.
  const tCache = new Map<string, ReturnType<typeof makeT>>();
  function makeT(namespace: string) {
    const ns = resolveNamespace(namespace);
    const t = (key: string, params?: Record<string, string | number>) => {
      let value = ns[key] ?? key;
      if (params) {
        value = Object.entries(params).reduce(
          (str, [k, v]) => str.replace(`{${k}}`, String(v)),
          value,
        );
      }
      return value;
    };
    t.rich = t;
    t.has = (key: string) => key in ns;
    return t;
  }

  return {
    useTranslations: (namespace: string) => {
      let cached = tCache.get(namespace);
      if (!cached) {
        cached = makeT(namespace);
        tCache.set(namespace, cached);
      }
      return cached;
    },
    useLocale: () => "en",
    useMessages: () => messages,
    useFormatter: () => ({}),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
