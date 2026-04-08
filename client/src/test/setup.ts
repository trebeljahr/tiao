import "@testing-library/jest-dom";
import { vi } from "vitest";
import enMessages from "../../messages/en.json";

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

  return {
    useTranslations: (namespace: string) => {
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
    },
    useLocale: () => "en",
    useMessages: () => messages,
    useFormatter: () => ({}),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
