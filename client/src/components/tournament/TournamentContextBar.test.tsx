import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { TournamentContextBar } from "./TournamentContextBar";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const messages = {
  tournament: {
    tournamentLabel: "Tournament",
    backToBracket: "Back to bracket",
  },
};

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("TournamentContextBar", () => {
  it("renders without crashing with minimal props", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t1" />);
    expect(screen.getByText("Tournament")).toBeInTheDocument();
  });

  it("renders tournament name when provided", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t1" tournamentName="Spring Cup" />);
    expect(screen.getByText("Spring Cup")).toBeInTheDocument();
  });

  it("does not render tournament name when not provided", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t1" />);
    expect(screen.queryByText("Spring Cup")).not.toBeInTheDocument();
  });

  it("shows Back to bracket link", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t1" />);
    expect(screen.getByText("Back to bracket")).toBeInTheDocument();
  });

  it("Back to bracket link points at the tournament page", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t123" />);
    const link = screen.getByText("Back to bracket").closest("a");
    expect(link).toHaveAttribute("href", "/tournament/t123");
  });

  it("renders all props together", () => {
    renderWithIntl(<TournamentContextBar tournamentId="t1" tournamentName="Winter Championship" />);
    expect(screen.getByText("Tournament")).toBeInTheDocument();
    expect(screen.getByText("Winter Championship")).toBeInTheDocument();
    expect(screen.getByText("Back to bracket")).toBeInTheDocument();
  });
});
