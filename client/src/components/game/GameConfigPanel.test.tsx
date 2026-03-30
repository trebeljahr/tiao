import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GameConfigPanel } from "./GameConfigPanel";
import { BOARD_SIZE_OPTIONS, SCORE_TO_WIN_OPTIONS } from "@shared";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
}));

const defaultProps = {
  mode: "multiplayer" as const,
  boardSize: 19,
  onBoardSizeChange: vi.fn(),
  scoreToWin: 10,
  onScoreToWinChange: vi.fn(),
  timeControl: null,
  onTimeControlChange: vi.fn(),
  submitLabel: "Create Game",
  onSubmit: vi.fn(),
};

describe("GameConfigPanel", () => {
  it("renders without crashing", () => {
    const { container } = render(<GameConfigPanel {...defaultProps} />);
    expect(container.firstElementChild).toBeTruthy();
  });

  it("renders all board size options", () => {
    render(<GameConfigPanel {...defaultProps} />);
    for (const size of BOARD_SIZE_OPTIONS) {
      expect(screen.getByText(`${size}x${size}`)).toBeInTheDocument();
    }
  });

  it("renders all score-to-win options", () => {
    render(<GameConfigPanel {...defaultProps} />);
    for (const score of SCORE_TO_WIN_OPTIONS) {
      expect(screen.getByText(String(score))).toBeInTheDocument();
    }
  });

  it("calls onBoardSizeChange when a board size button is clicked", () => {
    const onBoardSizeChange = vi.fn();
    render(<GameConfigPanel {...defaultProps} onBoardSizeChange={onBoardSizeChange} />);
    fireEvent.click(screen.getByText("9x9"));
    expect(onBoardSizeChange).toHaveBeenCalledWith(9);
  });

  it("calls onScoreToWinChange when a score button is clicked", () => {
    const onScoreToWinChange = vi.fn();
    render(<GameConfigPanel {...defaultProps} onScoreToWinChange={onScoreToWinChange} />);
    fireEvent.click(screen.getByText("5"));
    expect(onScoreToWinChange).toHaveBeenCalledWith(5);
  });

  it("shows submit button with provided label", () => {
    render(<GameConfigPanel {...defaultProps} />);
    expect(screen.getByText("Create Game")).toBeInTheDocument();
  });

  it("calls onSubmit when submit button clicked", () => {
    const onSubmit = vi.fn();
    render(<GameConfigPanel {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Create Game"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows creating text when busy", () => {
    render(<GameConfigPanel {...defaultProps} busy />);
    expect(screen.getByText("creating")).toBeInTheDocument();
  });

  it("disables submit button when busy", () => {
    render(<GameConfigPanel {...defaultProps} busy />);
    const btn = screen.getByText("creating").closest("button")!;
    expect(btn).toBeDisabled();
  });

  it("shows time control section for multiplayer mode", () => {
    render(<GameConfigPanel {...defaultProps} />);
    expect(screen.getByText("timeControl")).toBeInTheDocument();
  });

  it("hides time control section for computer mode", () => {
    render(<GameConfigPanel {...defaultProps} mode="computer" />);
    expect(screen.queryByText("timeControl")).not.toBeInTheDocument();
  });

  it("shows difficulty options for computer mode", () => {
    render(
      <GameConfigPanel
        {...defaultProps}
        mode="computer"
        difficulty={2}
        onDifficultyChange={vi.fn()}
      />,
    );
    expect(screen.getByText("difficulty")).toBeInTheDocument();
    expect(screen.getByText("easy")).toBeInTheDocument();
    expect(screen.getByText("intermediate")).toBeInTheDocument();
    expect(screen.getByText("hard")).toBeInTheDocument();
  });

  it("calls onDifficultyChange when difficulty clicked", () => {
    const onDifficultyChange = vi.fn();
    render(
      <GameConfigPanel
        {...defaultProps}
        mode="computer"
        difficulty={1}
        onDifficultyChange={onDifficultyChange}
      />,
    );
    fireEvent.click(screen.getByText("hard"));
    expect(onDifficultyChange).toHaveBeenCalledWith(3);
  });

  it("shows color selection for computer mode", () => {
    render(
      <GameConfigPanel
        {...defaultProps}
        mode="computer"
        selectedColor="random"
        onColorChange={vi.fn()}
      />,
    );
    expect(screen.getByText("playAs")).toBeInTheDocument();
    expect(screen.getByText("random")).toBeInTheDocument();
    expect(screen.getByText("white")).toBeInTheDocument();
    expect(screen.getByText("black")).toBeInTheDocument();
  });

  it("calls onColorChange when color clicked", () => {
    const onColorChange = vi.fn();
    render(
      <GameConfigPanel
        {...defaultProps}
        mode="computer"
        selectedColor="random"
        onColorChange={onColorChange}
      />,
    );
    fireEvent.click(screen.getByText("white"));
    expect(onColorChange).toHaveBeenCalledWith("white");
  });

  it("shows unlimited and with clocks toggle in time control", () => {
    render(<GameConfigPanel {...defaultProps} />);
    expect(screen.getByText("unlimited")).toBeInTheDocument();
    expect(screen.getByText("withClocks")).toBeInTheDocument();
  });

  it("calls onTimeControlChange when switching to clocks", () => {
    const onTimeControlChange = vi.fn();
    render(<GameConfigPanel {...defaultProps} onTimeControlChange={onTimeControlChange} />);
    fireEvent.click(screen.getByText("withClocks"));
    expect(onTimeControlChange).toHaveBeenCalledWith({
      initialMs: 300_000,
      incrementMs: 0,
    });
  });

  it("shows time presets when clock is enabled", () => {
    render(
      <GameConfigPanel {...defaultProps} timeControl={{ initialMs: 300_000, incrementMs: 0 }} />,
    );
    // Preset labels should appear
    expect(screen.getByText("1+0")).toBeInTheDocument();
    expect(screen.getByText("5+0")).toBeInTheDocument();
  });
});
