import type { AuthResponse } from "@shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateActiveBadges } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { BadgeSelector } from "./BadgeSelector";

vi.mock("@/lib/api", () => ({ updateActiveBadges: vi.fn() }));
vi.mock("@/lib/errors", () => ({ toastError: vi.fn() }));
const initial = {
  player: {
    kind: "account",
    badges: ["tournament-champion", "one-jump-wonder", "flawless-victory"],
    activeBadges: ["tournament-champion"],
  },
} as unknown as AuthResponse;
function Picker() {
  const [auth, setAuth] = useState(initial);
  return <BadgeSelector auth={auth} onAuthChange={setAuth} />;
}
describe("BadgeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateActiveBadges).mockResolvedValue({} as never);
  });
  it("selects a badge and hides it with visible, accessible selection feedback", async () => {
    render(<Picker />);
    const choice = screen.getByRole("button", { name: /one jump wonder/i });
    fireEvent.click(choice);
    expect(choice).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/one jump wonder/i);
    expect(updateActiveBadges).toHaveBeenCalledWith(["one-jump-wonder"]);
    fireEvent.click(screen.getByRole("button", { name: /hidden/i }));
    expect(screen.getByRole("button", { name: /hidden/i })).toHaveAttribute("aria-pressed", "true");
    expect(choice).toHaveAttribute("aria-pressed", "false");
    expect(updateActiveBadges).toHaveBeenLastCalledWith([]);
  });
  it("restores the previous selection when saving fails", async () => {
    vi.mocked(updateActiveBadges).mockRejectedValueOnce(new Error("offline"));
    render(<Picker />);
    fireEvent.click(screen.getByRole("button", { name: /one jump wonder/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /champion/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /one jump wonder/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
