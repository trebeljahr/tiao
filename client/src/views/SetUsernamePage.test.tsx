import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetUsernamePage } from "./SetUsernamePage";

const mockSetUsername = vi.fn();
const mockApplyAuth = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    setUsername: (...args: unknown[]) => mockSetUsername(...args),
  };
});

vi.mock("@/lib/errors", () => ({
  readableError: (error: unknown) =>
    error instanceof Error ? error.message : "Something went wrong.",
  toastError: vi.fn(),
  isNetworkError: () => false,
}));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: {
      player: {
        playerId: "sso-user-1",
        displayName: "John Doe",
        kind: "account",
        needsUsername: true,
      },
    },
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: mockApplyAuth,
  }),
}));

describe("SetUsernamePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the onboarding form", () => {
    render(<SetUsernamePage />);

    expect(screen.getByText("Set up your profile")).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("sanitizes input to lowercase with only valid characters", () => {
    render(<SetUsernamePage />);

    const input = screen.getByLabelText(/username/i);
    fireEvent.change(input, { target: { value: "John Doe 123!" } });

    expect(input).toHaveValue("johndoe123");
  });

  it("calls setUsername API and applyAuth on submit", async () => {
    mockSetUsername.mockResolvedValue({
      auth: {
        player: {
          playerId: "sso-user-1",
          displayName: "johndoe",
          kind: "account",
        },
      },
    });

    render(<SetUsernamePage />);

    const input = screen.getByLabelText(/username/i);
    fireEvent.change(input, { target: { value: "johndoe" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(mockSetUsername).toHaveBeenCalledWith("johndoe");
    });

    await waitFor(() => {
      expect(mockApplyAuth).toHaveBeenCalledWith({
        player: {
          playerId: "sso-user-1",
          displayName: "johndoe",
          kind: "account",
        },
      });
    });

    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("shows error when API rejects", async () => {
    mockSetUsername.mockRejectedValue(
      Object.assign(new Error("That username is already taken."), { status: 409 }),
    );

    render(<SetUsernamePage />);

    const input = screen.getByLabelText(/username/i);
    fireEvent.change(input, { target: { value: "taken-name" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText("That username is already taken.")).toBeInTheDocument();
    });
  });

  it("disables submit button when username is too short", () => {
    render(<SetUsernamePage />);

    const input = screen.getByLabelText(/username/i);
    fireEvent.change(input, { target: { value: "ab" } });

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
