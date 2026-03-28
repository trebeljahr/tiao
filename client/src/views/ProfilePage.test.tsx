import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@/test/navigation-mock";
import type { AuthResponse } from "@shared";
import { ProfilePage } from "./ProfilePage";

const mockUpdateAccountProfile = vi.fn();
const mockApplyAuth = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAccountProfile: vi.fn().mockResolvedValue({
      profile: {
        displayName: "TestUser",
        email: "test@example.com",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    }),
    updateAccountProfile: (...args: unknown[]) => mockUpdateAccountProfile(...args),
    uploadAccountProfilePicture: vi.fn(),
  };
});

function motionProxy(tag: string) {
  return ({ children, onClick, className, ...rest }: Record<string, unknown>) => {
    const Tag = tag as keyof JSX.IntrinsicElements;
    return (
      <Tag
        onClick={onClick as React.MouseEventHandler}
        className={className as string}
        {...filterDomProps(rest)}
      >
        {children as React.ReactNode}
      </Tag>
    );
  };
}

function filterDomProps(props: Record<string, unknown>) {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      ![
        "initial",
        "animate",
        "exit",
        "transition",
        "variants",
        "whileHover",
        "whileTap",
        "layout",
        "layoutId",
      ].includes(key)
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

vi.mock("framer-motion", () => {
  const handler = {
    get(_target: unknown, tag: string) {
      return motionProxy(tag);
    },
  };
  return {
    motion: new Proxy({}, handler),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const accountAuth: AuthResponse = {
  player: {
    playerId: "acc-1",
    displayName: "TestUser",
    kind: "account",
  },
};

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: accountAuth,
    authLoading: false,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    applyAuth: mockApplyAuth,
  }),
}));

vi.mock("@/lib/SocialNotificationsContext", () => ({
  useSocialNotifications: () => ({
    pendingFriendRequestCount: 0,
    incomingInvitationCount: 0,
    refreshNotifications: vi.fn(),
  }),
}));

function fillInput(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ProfilePage password change modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Change password' button for account users", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });
  });

  it("opens password modal when clicking 'Change password'", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(screen.getByText("Change password", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it("shows error when new passwords do not match", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "differentpass");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(screen.getByText(/new passwords do not match/i)).toBeInTheDocument();
    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
  });

  it("shows error when new password is too short", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "short");
    fillInput(/confirm new password/i, "short");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
  });

  it("calls updateAccountProfile with currentPassword and new password on valid submit", async () => {
    mockUpdateAccountProfile.mockResolvedValue({
      auth: accountAuth,
      profile: {
        displayName: "TestUser",
        email: "test@example.com",
      },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(mockUpdateAccountProfile).toHaveBeenCalledWith({
        currentPassword: "oldpass123",
        password: "newpass1234",
      });
    });
  });

  it("closes modal and shows success message after successful password change", async () => {
    mockUpdateAccountProfile.mockResolvedValue({
      auth: accountAuth,
      profile: {
        displayName: "TestUser",
        email: "test@example.com",
      },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password changed/i)).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });

  it("shows server error in modal when API rejects", async () => {
    mockUpdateAccountProfile.mockRejectedValue(
      Object.assign(new Error("Current password is incorrect."), { status: 401 }),
    );

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "wrongpass");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/current password is incorrect/i)).toBeInTheDocument();
    });
  });

  it("closes modal when Cancel is clicked", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });
});
