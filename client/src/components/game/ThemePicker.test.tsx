import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBoardTheme } from "@/lib/useBoardTheme";
import { ThemePicker } from "./ThemePicker";

vi.mock("@/lib/featureGate", () => ({ isDevFeatureEnabled: () => false, canSeeShop: () => false }));
describe("ThemePicker", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardTheme();
  });
  it("shows only owned themes and updates the selected theme", () => {
    render(<ThemePicker unlockedThemeIds={["night"]} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Night board theme" }));
    expect(screen.getByRole("button", { name: "Night board theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Classic board theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Ocean board theme" })).not.toBeInTheDocument();
  });
});
