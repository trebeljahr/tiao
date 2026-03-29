import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TutorialPage } from "./TutorialPage";

// Mock canvas-confetti
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// Mock Navbar to avoid SVG rendering issues in jsdom
vi.mock("@/components/Navbar", () => ({
  Navbar: () => <nav data-testid="navbar" />,
}));

// Mock framer-motion to render children immediately without animation
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Filter out non-DOM props from framer-motion
function filterDomProps(props: Record<string, unknown>) {
  const nonDom = [
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "custom",
    "whileHover",
    "whileTap",
    "layout",
  ];
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!nonDom.includes(k)) filtered[k] = v;
  }
  return filtered;
}

vi.mock("@/lib/api", () => ({
  markTutorialComplete: vi.fn().mockResolvedValue({ auth: {} }),
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: {
      player: {
        kind: "account",
        playerId: "user-1",
        displayName: "Tester",
        hasSeenTutorial: false,
      },
    },
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: vi.fn(),
  }),
}));

// Mock InteractiveMiniBoard — renders a button that triggers onComplete
vi.mock("@/components/tutorial/InteractiveMiniBoard", () => ({
  InteractiveMiniBoard: ({
    onComplete,
  }: {
    onComplete: () => void;
    active: boolean;
    resetKey: number;
    config: unknown;
    t: unknown;
  }) => (
    <div data-testid="mini-board">
      <button data-testid="complete-challenge" onClick={onComplete}>
        Complete
      </button>
    </div>
  ),
}));

describe("TutorialPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Next button on non-interactive (welcome) step", () => {
    render(<TutorialPage />);

    // Step 1 is "welcome" — non-interactive, should show Next
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("shows 'complete the challenge' hint on first-time interactive step, not Next button", () => {
    render(<TutorialPage />);

    // Navigate to step 2 (index 1) — "place" step, interactive
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Should show the challenge hint, not the Next button
    expect(screen.getByText(/complete the challenge/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("hides Next button after completing an interactive step on first playthrough (auto-advance)", () => {
    render(<TutorialPage />);

    // Go to step 2 (interactive)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Complete the challenge
    fireEvent.click(screen.getByTestId("complete-challenge"));

    // The Next button should still be hidden — auto-advance will handle navigation
    // (before the auto-advance timer fires)
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("auto-advances to next step after completing an interactive step", () => {
    render(<TutorialPage />);

    // Go to step 2 (interactive "place" step)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText(/complete the challenge/i)).toBeInTheDocument();

    // Complete the challenge
    fireEvent.click(screen.getByTestId("complete-challenge"));

    // Advance the auto-advance timer (900ms)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should now be on step 3 — the "jump" step (also interactive)
    // Verify we moved forward: step counter should show "3 /"
    expect(screen.getByText(/3 \//)).toBeInTheDocument();
  });

  it("shows Next button when navigating back to an already-completed interactive step", () => {
    render(<TutorialPage />);

    // Go to step 2 (interactive)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Complete the challenge
    fireEvent.click(screen.getByTestId("complete-challenge"));

    // Let auto-advance happen
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Now on step 3 — go back to step 2
    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    // Step 2 is completed and we navigated back — should show Next button
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(screen.queryByText(/complete the challenge/i)).not.toBeInTheDocument();
  });

  it("shows Next button when clicking a completed step's progress dot", () => {
    render(<TutorialPage />);

    // Go to step 2 (interactive)
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Complete the challenge
    fireEvent.click(screen.getByTestId("complete-challenge"));

    // Let auto-advance happen
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Now on step 3 — click dot for step 2 (aria-label "Go to step 2")
    fireEvent.click(screen.getByLabelText("Go to step 2"));

    // Should show Next button since step 2 is completed and we're revisiting
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });
});
