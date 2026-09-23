import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AboutPage, GITHUB_REPO_URL, GITHUB_SPONSORS_URL } from "./AboutPage";

// The global next-intl mock (src/test/setup.ts) aliases t.rich to t, which
// returns the raw "<tag>…</tag>" string and never calls the tag renderers.
// This page's creator + license links live inside rich tags, so give it a
// t.rich that actually resolves them.
vi.mock("next-intl", async () => {
  const enMessages = (await import("../../messages/en.json")).default;
  const ns = (enMessages as { about: Record<string, string> }).about;
  const t = (key: string) => ns[key] ?? key;
  t.rich = (key: string, tags: Record<string, (chunks: ReactNode) => ReactNode>) => {
    const value = ns[key] ?? key;
    const parts: ReactNode[] = [];
    const re = /<(\w+)>(.*?)<\/\1>/g;
    let last = 0;
    for (const match of value.matchAll(re)) {
      const [whole, tag, inner] = match;
      const index = match.index ?? 0;
      parts.push(value.slice(last, index));
      parts.push(<span key={index}>{tags[tag]?.(inner) ?? inner}</span>);
      last = index + whole.length;
    }
    parts.push(value.slice(last));
    return <>{parts}</>;
  };
  t.has = (key: string) => key in ns;
  return {
    useTranslations: () => t,
    useLocale: () => "en",
  };
});

// Navbar pulls in SocialNotificationsContext + lazy SoundToggle; not under test here.
vi.mock("@/components/Navbar", () => ({
  Navbar: () => <nav data-testid="navbar" />,
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: null,
    authLoading: false,
    authBootstrapped: true,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: vi.fn(),
  }),
}));

describe("AboutPage", () => {
  it("renders every section heading", () => {
    render(<AboutPage />);

    expect(screen.getByRole("heading", { level: 1, name: "About Tiao" })).toBeInTheDocument();
    for (const heading of [
      "What Tiao is",
      "Why the code is open",
      "How to support Tiao",
      "Who made it",
      "Source and license",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it("links to the repo, GitHub Sponsors and the license files", () => {
    render(<AboutPage />);

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(GITHUB_REPO_URL);
    expect(hrefs).toContain(GITHUB_SPONSORS_URL);
    expect(hrefs).toContain(`${GITHUB_REPO_URL}/blob/main/LICENSE`);
    expect(hrefs).toContain(`${GITHUB_REPO_URL}/blob/main/LICENSE-EXCEPTIONS.md`);
  });

  it("links to both creator pages", () => {
    render(<AboutPage />);

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/creators/andreas");
    expect(hrefs).toContain("/creators/rico");
  });

  it("shows the Discord placeholder when no invite URL is configured", () => {
    render(<AboutPage />);

    expect(screen.getByText(/A Discord server is planned/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ko-fi" })).not.toBeInTheDocument();
  });

  it("mentions the AGPL notice", () => {
    render(<AboutPage />);

    expect(
      screen.getAllByText(/GNU Affero General Public License, version 3/).length,
    ).toBeGreaterThan(0);
  });
});
