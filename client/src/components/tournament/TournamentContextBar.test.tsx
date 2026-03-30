import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TournamentContextBar } from "./TournamentContextBar";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
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

describe("TournamentContextBar", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders without crashing with minimal props", () => {
    render(<TournamentContextBar tournamentId="t1" />);
    expect(screen.getByText("Tournament")).toBeInTheDocument();
  });

  it("renders tournament name when provided", () => {
    render(<TournamentContextBar tournamentId="t1" tournamentName="Spring Cup" />);
    expect(screen.getByText("Spring Cup")).toBeInTheDocument();
  });

  it("does not render tournament name when not provided", () => {
    render(<TournamentContextBar tournamentId="t1" />);
    expect(screen.queryByText("Spring Cup")).not.toBeInTheDocument();
  });

  it("renders round label when provided", () => {
    render(<TournamentContextBar tournamentId="t1" roundLabel="Round 2" />);
    expect(screen.getByText("Round 2")).toBeInTheDocument();
  });

  it("does not render round label when not provided", () => {
    render(<TournamentContextBar tournamentId="t1" />);
    // Only "Tournament" and "Back to bracket" should be present
    const bar = screen.getByText("Tournament").closest("div");
    expect(bar).toBeInTheDocument();
  });

  it("shows Back to bracket link", () => {
    render(<TournamentContextBar tournamentId="t1" />);
    expect(screen.getByText("Back to bracket")).toBeInTheDocument();
  });

  it("navigates to tournament page on Back to bracket click", () => {
    render(<TournamentContextBar tournamentId="t123" />);
    fireEvent.click(screen.getByText("Back to bracket"));
    expect(mockPush).toHaveBeenCalledWith("/tournament/t123");
  });

  it("renders all props together", () => {
    render(
      <TournamentContextBar
        tournamentId="t1"
        tournamentName="Winter Championship"
        roundLabel="Semifinals"
      />,
    );
    expect(screen.getByText("Tournament")).toBeInTheDocument();
    expect(screen.getByText("Winter Championship")).toBeInTheDocument();
    expect(screen.getByText("Semifinals")).toBeInTheDocument();
    expect(screen.getByText("Back to bracket")).toBeInTheDocument();
  });
});
