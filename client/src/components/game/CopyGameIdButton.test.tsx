import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyGameIdButton } from "./CopyGameIdButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("CopyGameIdButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the game id as button text", () => {
    render(<CopyGameIdButton gameId="abc-123" />);
    expect(screen.getByText("abc-123")).toBeInTheDocument();
  });

  it("writes the game id to clipboard on click", () => {
    render(<CopyGameIdButton gameId="abc-123" />);
    fireEvent.click(screen.getByText("abc-123"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("abc-123");
  });

  it("shows copied feedback after click and reverts after timeout", () => {
    render(<CopyGameIdButton gameId="abc-123" />);
    fireEvent.click(screen.getByText("abc-123"));
    expect(screen.getByText("copied")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(screen.getByText("abc-123")).toBeInTheDocument();
    expect(screen.queryByText("copied")).not.toBeInTheDocument();
  });

  it("uses ghost variant styling by default", () => {
    render(<CopyGameIdButton gameId="abc-123" />);
    const btn = screen.getByText("abc-123");
    expect(btn.className).toContain("text-[#b5a48e]");
    expect(btn.className).not.toContain("bg-white");
  });

  it("uses white variant styling when variant=white", () => {
    render(<CopyGameIdButton gameId="abc-123" variant="white" />);
    const btn = screen.getByText("abc-123");
    expect(btn.className).toContain("bg-white");
    expect(btn.className).toContain("border");
  });

  it("merges custom className", () => {
    render(<CopyGameIdButton gameId="abc-123" className="custom-class" />);
    expect(screen.getByText("abc-123").className).toContain("custom-class");
  });
});
