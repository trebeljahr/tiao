import { vi } from "vitest";
export const mockPush = vi.fn();
export const mockReplace = vi.fn();
export const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
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

export const mockIntlPush = vi.fn();
export const mockIntlReplace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    push: mockIntlPush,
    replace: mockIntlReplace,
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  Link: "a",
  redirect: vi.fn(),
}));
