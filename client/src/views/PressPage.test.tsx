import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESS_EMAIL, PRESS_KIT_ZIP_PATH } from "@/lib/pressKit";
import { PressPage } from "./PressPage";

vi.mock("@/components/Navbar", () => ({
  Navbar: () => <nav data-testid="navbar" />,
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ auth: null, onOpenAuth: vi.fn(), onLogout: vi.fn() }),
}));

describe("PressPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders the fact sheet, creator credits and press contact", () => {
    render(<PressPage downloadAvailable />);

    expect(screen.getByRole("heading", { level: 1, name: "Tiao press kit" })).toBeInTheDocument();
    expect(screen.getByText("Andreas Edmeier (game design)")).toBeInTheDocument();
    expect(screen.getByText("Rico Trebeljahr (software, site, operations)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PRESS_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${PRESS_EMAIL}`,
    );
    expect(screen.getAllByRole("link", { name: "Creator page" })).toHaveLength(2);
  });

  it("links the zip when the press kit exists", () => {
    render(<PressPage downloadAvailable />);

    const link = screen.getByRole("link", { name: "Download the press kit (zip)" });
    expect(link).toHaveAttribute("href", `/${PRESS_KIT_ZIP_PATH}`);
    expect(link).toHaveAttribute("download");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a coming-soon note instead of a dead link when the zip is missing", () => {
    render(<PressPage downloadAvailable={false} />);

    expect(screen.queryByRole("link", { name: "Download the press kit (zip)" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The zip is not ready yet.");
    expect(document.querySelector(`a[href="/${PRESS_KIT_ZIP_PATH}"]`)).toBeNull();
  });
});
