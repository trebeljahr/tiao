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
  const messages = enMessages as Record<string, Record<string, string>>;

  return {
    useTranslations: (namespace: string) => {
      const ns = messages[namespace] ?? {};
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
      return t;
    },
    useLocale: () => "en",
    useMessages: () => messages,
    useFormatter: () => ({}),
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
