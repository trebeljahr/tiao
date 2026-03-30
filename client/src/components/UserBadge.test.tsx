import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserBadge, BADGE_DEFINITIONS, ALL_BADGE_IDS, type BadgeId } from "./UserBadge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("UserBadge", () => {
  it("renders without crashing", () => {
    const { container } = render(<UserBadge badge="supporter" />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("renders the translated badge key as text", () => {
    render(<UserBadge badge="supporter" />);
    expect(screen.getByText("supporter")).toBeInTheDocument();
  });

  it("renders different translation keys for different badges", () => {
    const { rerender } = render(<UserBadge badge="contributor" />);
    expect(screen.getByText("contributor")).toBeInTheDocument();

    rerender(<UserBadge badge="official-champion" />);
    expect(screen.getByText("champion")).toBeInTheDocument();

    rerender(<UserBadge badge="creator" />);
    expect(screen.getByText("creator")).toBeInTheDocument();

    rerender(<UserBadge badge="super-supporter" />);
    expect(screen.getByText("superSupporter")).toBeInTheDocument();
  });

  it("applies gradient background from badge definition", () => {
    const { container } = render(<UserBadge badge="supporter" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.background).toBe(BADGE_DEFINITIONS.supporter.gradient);
  });

  it("applies text color from badge definition", () => {
    const { container } = render(<UserBadge badge="supporter" />);
    const el = container.firstElementChild as HTMLElement;
    // jsdom normalizes hex to rgb
    expect(el.style.color).toBe("rgb(255, 255, 255)");
  });

  it("applies compact styles when compact prop is true", () => {
    const { container } = render(<UserBadge badge="supporter" compact />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("px-1.5");
    expect(el.className).toContain("text-[8px]");
  });

  it("applies normal styles when compact is false", () => {
    const { container } = render(<UserBadge badge="supporter" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("px-2");
    expect(el.className).toContain("text-[10px]");
  });

  it("applies custom className", () => {
    const { container } = render(<UserBadge badge="supporter" className="ml-2" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("ml-2");
  });

  it("applies shimmer animation for tier 2 badges", () => {
    const { container } = render(<UserBadge badge="super-supporter" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.animation).toContain("badge-shimmer");
    expect(el.style.backgroundSize).toBe("200% 100%");
  });

  it("applies rainbow animation for tier 3 badges", () => {
    const { container } = render(<UserBadge badge="creator" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.animation).toContain("badge-rainbow");
    expect(el.style.animation).toContain("badge-glow-pulse");
  });

  it("does not apply animation for tier 1 badges", () => {
    const { container } = render(<UserBadge badge="supporter" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.animation).toBe("");
  });

  it("returns null for an invalid badge id", () => {
    const { container } = render(<UserBadge badge={"nonexistent" as BadgeId} />);
    expect(container.firstElementChild).toBeNull();
  });

  it("renders every defined badge without crashing", () => {
    ALL_BADGE_IDS.forEach((id) => {
      const { container } = render(<UserBadge badge={id} />);
      expect(container.firstElementChild).toBeTruthy();
    });
  });
});
