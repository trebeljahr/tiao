import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameConfigBadge } from "./GameConfigBadge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
}));

describe("GameConfigBadge", () => {
  it("renders nothing when no props are set and showAll is false", () => {
    const { container } = render(<GameConfigBadge />);
    expect(container.firstElementChild).toBeNull();
  });

  it("renders nothing when all values are defaults and showAll is false", () => {
    const { container } = render(<GameConfigBadge boardSize={19} scoreToWin={10} />);
    expect(container.firstElementChild).toBeNull();
  });

  it("renders board size when it differs from default 19", () => {
    render(<GameConfigBadge boardSize={9} />);
    expect(screen.getByText("9x9")).toBeInTheDocument();
  });

  it("renders board size when showAll is true even for default 19x19", () => {
    render(<GameConfigBadge boardSize={19} showAll />);
    expect(screen.getByText(/19x19/)).toBeInTheDocument();
  });

  it("renders scoreToWin when it differs from default 10", () => {
    render(<GameConfigBadge scoreToWin={5} />);
    // compact not set, uses nToWin key
    expect(screen.getByText(/nToWin/)).toBeInTheDocument();
  });

  it("renders compact score label when compact is true", () => {
    render(<GameConfigBadge scoreToWin={5} compact />);
    expect(screen.getByText(/nPts/)).toBeInTheDocument();
  });

  it("renders time control with increment", () => {
    render(<GameConfigBadge timeControl={{ initialMs: 300_000, incrementMs: 2_000 }} />);
    expect(screen.getByText(/5\+2/)).toBeInTheDocument();
  });

  it("renders time control without increment using nMin", () => {
    render(<GameConfigBadge timeControl={{ initialMs: 300_000, incrementMs: 0 }} />);
    expect(screen.getByText(/nMin/)).toBeInTheDocument();
  });

  it("renders unlimited time label when showAll and no timeControl", () => {
    render(<GameConfigBadge showAll boardSize={19} />);
    expect(screen.getByText(/unlimitedTime/)).toBeInTheDocument();
  });

  it("renders roomType for tournament", () => {
    render(<GameConfigBadge roomType="tournament" showAll boardSize={19} />);
    expect(screen.getByText(/title/)).toBeInTheDocument();
  });

  it("renders roomType for matchmaking", () => {
    render(<GameConfigBadge roomType="matchmaking" showAll boardSize={19} />);
    expect(screen.getByText(/matchmaking/)).toBeInTheDocument();
  });

  it("joins multiple parts with separator", () => {
    render(
      <GameConfigBadge
        boardSize={9}
        scoreToWin={5}
        timeControl={{ initialMs: 60_000, incrementMs: 0 }}
        compact
      />,
    );
    const text = screen.getByText(/9x9/).textContent!;
    expect(text).toContain("·");
  });
});
