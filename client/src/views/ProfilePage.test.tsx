import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@/test/navigation-mock";
import type { AuthResponse } from "@shared";
import { ProfilePage } from "./ProfilePage";

const mockToastError = vi.fn();
vi.mock("@/lib/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errors")>();
  return {
    ...actual,
    toastError: (...args: unknown[]) => mockToastError(...args),
  };
});

const mockUpdateAccountProfile = vi.fn();
const mockDeleteAccount = vi.fn();
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
        providers: ["credential"],
      },
    }),
    updateAccountProfile: (...args: unknown[]) => mockUpdateAccountProfile(...args),
    uploadAccountProfilePicture: vi.fn(),
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
  };
});

function motionProxy(tag: string) {
  return ({ children, onClick, className, ...rest }: Record<string, unknown>) => {
    const Tag = tag as keyof React.JSX.IntrinsicElements;
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

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    linkSocial: vi.fn().mockResolvedValue({ data: { url: "" } }),
    unlinkAccount: vi.fn().mockResolvedValue({ data: { status: true } }),
  },
}));

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
    expect(await screen.findByRole("button", { name: /change password/i })).toBeInTheDocument();
  });

  it("opens password modal when clicking 'Change password'", async () => {
    render(<ProfilePage />);

    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    expect(screen.getByText("Change password", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it("shows error when new passwords do not match", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "differentpass");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(screen.getByText(/new passwords do not match/i)).toBeInTheDocument();
    expect(mockUpdateAccountProfile).not.toHaveBeenCalled();
  });

  it("shows error when new password is too short", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

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
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    // Mock fires synchronously inside the click handler before the await.
    expect(mockUpdateAccountProfile).toHaveBeenCalledWith({
      currentPassword: "oldpass123",
      password: "newpass1234",
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
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "oldpass123");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    // Success banner appears after updateAccountProfile resolves — single
    // async boundary, use findByText.
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });

  it("shows server error in modal when API rejects", async () => {
    mockUpdateAccountProfile.mockRejectedValue(
      Object.assign(new Error("Current password is incorrect."), { status: 401 }),
    );

    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    fillInput(/current password/i, "wrongpass");
    fillInput(/^new password$/i, "newpass1234");
    fillInput(/confirm new password/i, "newpass1234");

    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    // Error text appears after updateAccountProfile rejects — single
    // async boundary.
    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
  });

  it("closes modal when Cancel is clicked", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /change password/i }));

    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
  });
});

describe("ProfilePage copy profile link (#93)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Copy profile link' button for logged-in users", async () => {
    render(<ProfilePage />);
    expect(await screen.findByRole("button", { name: /copy profile link/i })).toBeInTheDocument();
  });

  it("calls navigator.clipboard.writeText with the correct URL when clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /copy profile link/i }));

    // Clipboard write fires synchronously inside the click handler.
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/profile/TestUser"));
  });
});

describe("ProfilePage delete account (#91)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Delete Account' button and description", async () => {
    render(<ProfilePage />);
    expect(await screen.findByRole("button", { name: /delete account/i })).toBeInTheDocument();
  });

  it("opens a confirmation dialog when clicking Delete Account", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));
    expect(screen.getByText(/delete your account\?/i)).toBeInTheDocument();
  });

  it("has 'Delete My Account' button disabled when name does not match", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    const deleteBtn = screen.getByRole("button", { name: /delete my account/i });
    expect(deleteBtn).toBeDisabled();
  });

  it("enables 'Delete My Account' button when name matches exactly", async () => {
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    const input = screen.getByPlaceholderText("TestUser");
    fireEvent.change(input, { target: { value: "TestUser" } });

    const deleteBtn = screen.getByRole("button", { name: /delete my account/i });
    expect(deleteBtn).toBeEnabled();
  });

  it("calls deleteAccount API when confirmed", async () => {
    mockDeleteAccount.mockResolvedValue({ message: "deleted" });

    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /delete account/i }));

    const input = screen.getByPlaceholderText("TestUser");
    fireEvent.change(input, { target: { value: "TestUser" } });

    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));

    // Mock fires synchronously inside the click handler before the await.
    expect(mockDeleteAccount).toHaveBeenCalled();
  });
});

describe("ProfilePage OAuth linking (#98, #100)", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset location.search to empty
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...originalLocation,
        search: "",
        pathname: "/settings",
        origin: "http://localhost",
        href: "http://localhost/settings",
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  // NOTE: `?error=` toasting and URL cleanup used to live in ProfilePage,
  // but that logic has been moved to the global `OAuthErrorHandler` in
  // `app/[locale]/providers.tsx` (since bd766c78) so the toast fires on
  // whatever page the OAuth flow was initiated from, not just /settings.
  // ProfilePage now only clears the `oauthLinkReturnPath` sessionStorage
  // breadcrumb on mount. The error-toast / URL-cleanup behavior belongs
  // to an OAuthErrorHandler test, not here.

  it("passes callbackURL pointing to /profile when linking (#100)", async () => {
    const { authClient } = await import("@/lib/auth-client");

    render(<ProfilePage />);
    // The providers mock returns ["credential"], so GitHub should be available to link
    fireEvent.click(await screen.findByRole("button", { name: /github/i }));

    // linkSocial is called synchronously inside the click handler.
    expect(authClient.linkSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        callbackURL: "http://localhost/settings",
      }),
    );
  });

  it("stashes current pathname in sessionStorage before linking so the error handler can bounce back", async () => {
    sessionStorage.removeItem("oauthLinkReturnPath");

    render(<ProfilePage />);
    const githubBtn = await screen.findByRole("button", { name: /github/i });

    // ProfilePage's cleanup effect runs on mount and clears any stale value
    // before the user clicks. Confirm the click itself is what populates it.
    expect(sessionStorage.getItem("oauthLinkReturnPath")).toBeNull();

    fireEvent.click(githubBtn);

    // sessionStorage write happens synchronously inside the click handler,
    // before linkSocial is even invoked.
    expect(sessionStorage.getItem("oauthLinkReturnPath")).toBe("/settings");
  });

  it("keeps the link button in the linking state after linkSocial resolves successfully (no flicker back to idle before the OAuth redirect navigates away)", async () => {
    const { authClient } = await import("@/lib/auth-client");
    // A successful linkSocial resolves with no error — the page is about to
    // be replaced by the OAuth provider redirect, so the button must stay
    // in "Linking…" until navigation happens, not snap back to its label.
    vi.mocked(authClient.linkSocial).mockResolvedValueOnce({ data: { url: "" } } as never);

    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /github/i }));

    // linkSocial is called synchronously, then the button re-renders into
    // the "Linking…" state after the await resolves. findByRole waits for
    // that single async boundary.
    expect(authClient.linkSocial).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /linking/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^github$/i })).not.toBeInTheDocument();
  });

  it("clears the busy state when linkSocial resolves with an error", async () => {
    const { authClient } = await import("@/lib/auth-client");
    vi.mocked(authClient.linkSocial).mockResolvedValueOnce({
      data: null,
      error: { code: "access_denied", message: "nope" },
    } as never);

    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /github/i }));

    // After error, the button returns to the "GitHub" label so the user can
    // retry immediately in-place. The button is already in the DOM (from
    // the initial render), but findByRole re-waits until the label flips
    // back from "Linking…" to "GitHub".
    expect(await screen.findByRole("button", { name: /^github$/i })).toBeInTheDocument();
  });
});
