import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnlockedBoardThemesContext } from "@/lib/UnlockedBoardThemesContext";
import { resetBoardTheme } from "@/lib/useBoardTheme";
import { ThemePicker } from "./ThemePicker";

vi.mock("@/lib/featureGate", () => ({ isDevFeatureEnabled: () => false, canSeeShop: () => false }));
describe("ThemePicker", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardTheme();
  });
  it("shows only owned themes and updates the selected theme", () => {
    render(
      <UnlockedBoardThemesContext.Provider value={["night"]}>
        <ThemePicker unlockedThemeIds={["night"]} />
      </UnlockedBoardThemesContext.Provider>,
    );
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

  it("shows Classic as selected for a guest with a stale saved paid theme", () => {
    localStorage.setItem("tiao:boardTheme", "night");
    render(<ThemePicker />);
    expect(screen.getByRole("button", { name: "Classic board theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Night board theme" })).not.toBeInTheDocument();
  });
});
