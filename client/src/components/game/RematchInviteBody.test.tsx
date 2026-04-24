import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RematchInviteBody } from "./RematchInviteBody";

// Stub next-intl so tests don't need the real locale loader. Returns keys
// verbatim (or key + serialised values for ICU-style messages) so assertions
// can match on stable strings regardless of locale.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
}));

// Stub PlayerIdentityRow — its own test suite covers the row itself. Here we
// only need to verify RematchInviteBody *passes* the opponent through.
vi.mock("@/components/PlayerIdentityRow", () => ({
  PlayerIdentityRow: ({ player }: { player: { displayName?: string } }) => (
    <span data-testid="opponent">{player?.displayName ?? "?"}</span>
  ),
}));

describe("RematchInviteBody", () => {
  const baseProps = {
    opponent: {
      playerId: "opp",
      displayName: "Opponent",
    },
    boardSize: 19,
    scoreToWin: 10,
    timeControl: null,
    roomType: "direct" as const,
  };

  it("renders opponent, 'wants a rematch' label, and full config via GameConfigBadge(showAll)", () => {
    render(<RematchInviteBody {...baseProps} nextColor="white" />);

    // Opponent stub receives the player prop
    expect(screen.getByTestId("opponent")).toHaveTextContent("Opponent");

    // The "wants a rematch" hint is present
    expect(screen.getByText("rematchToastDesc")).toBeInTheDocument();

    // Color badge rendered with translated color label — next-intl stub echoes
    // the key + values, so `wouldPlayAs:{"color":"..."}` should appear.
    expect(screen.getByText(/wouldPlayAs/)).toBeInTheDocument();
  });

  it("shows board size / score / time / room type even when they match defaults (showAll=true)", () => {
    // 19×19, 10pts, unlimited time is the *default* config — GameConfigBadge
    // would normally hide all three parts. RematchInviteBody passes `showAll`
    // so rematch cards always surface the settings, even for default games.
    render(<RematchInviteBody {...baseProps} nextColor="black" />);

    // 19x19 is shown (not hidden as "matches default")
    expect(screen.getByText(/19x19/)).toBeInTheDocument();
    // nToWin key with n=10 (matches default but still shown because showAll)
    expect(screen.getByText(/nToWin.*10/)).toBeInTheDocument();
    // Unlimited time label (matches default but still shown because showAll)
    expect(screen.getByText(/unlimitedTime/)).toBeInTheDocument();
  });

  it("falls back to 'rematchRequested' label when opponent is null", () => {
    render(<RematchInviteBody {...baseProps} opponent={null} nextColor={null} />);
    expect(screen.getByText("rematchRequested")).toBeInTheDocument();
    // No color badge when nextColor is null
    expect(screen.queryByText(/wouldPlayAs/)).not.toBeInTheDocument();
  });

  it("hides color badge when nextColor is not provided", () => {
    render(<RematchInviteBody {...baseProps} />);
    expect(screen.queryByText(/wouldPlayAs/)).not.toBeInTheDocument();
  });
});
