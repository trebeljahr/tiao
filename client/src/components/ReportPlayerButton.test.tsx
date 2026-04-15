import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportPlayerButton } from "./ReportPlayerButton";

// Track reportPlayer calls
const mockReportPlayer = vi.fn();

vi.mock("@/lib/api", () => ({
  reportPlayer: (...args: unknown[]) => mockReportPlayer(...args),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ReportPlayerButton", () => {
  beforeEach(() => {
    mockReportPlayer.mockReset();
    mockReportPlayer.mockResolvedValue({ ok: true });
  });

  it("renders a report button", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    expect(screen.getByTitle("Report player")).toBeInTheDocument();
  });

  it("opens the report dialog when clicked", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    expect(screen.getByText("Report alice")).toBeInTheDocument();
  });

  it("shows reason options in the dialog", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    expect(screen.getByText("Offensive or inappropriate username")).toBeInTheDocument();
    expect(screen.getByText("Inappropriate profile picture")).toBeInTheDocument();
    expect(screen.getByText("Harassment or toxic behavior")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("disables Next when no reason is selected", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    const nextBtn = screen.getByText("Next");
    expect(nextBtn).toBeDisabled();
  });

  it("enables Next when a reason is selected", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    fireEvent.click(screen.getByText("Offensive or inappropriate username"));
    const nextBtn = screen.getByText("Next");
    expect(nextBtn).not.toBeDisabled();
  });

  it("goes to confirm step and calls reportPlayer on confirm", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    fireEvent.click(screen.getByText("Harassment or toxic behavior"));
    fireEvent.click(screen.getByText("Next"));
    // Now on confirm step
    expect(screen.getByText("Please confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Yes, submit report"));

    // reportPlayer is called synchronously inside handleSubmit before the
    // await suspends, so we can assert immediately without waitFor polling.
    expect(mockReportPlayer).toHaveBeenCalledWith("p1", "harassment", undefined);
  });

  it("back button returns from confirm step to choose step", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    fireEvent.click(screen.getByText("Harassment or toxic behavior"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Please confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.queryByText("Please confirm")).not.toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("shows textarea when 'Other' is selected", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    fireEvent.click(screen.getByText("Other"));
    expect(screen.getByPlaceholderText("Please describe the issue...")).toBeInTheDocument();
  });

  it("requires details text when 'Other' is selected", () => {
    render(<ReportPlayerButton playerId="p1" displayName="alice" />);
    fireEvent.click(screen.getByTitle("Report player"));
    fireEvent.click(screen.getByText("Other"));
    const nextBtn = screen.getByText("Next");
    expect(nextBtn).toBeDisabled();
  });
});
