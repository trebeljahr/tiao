import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "./Navbar";

vi.mock("@/components/game/ThemePicker", () => ({ ThemePicker: () => <div>Board theme</div> }));
vi.mock("@/components/SoundToggle", () => ({ SoundToggle: () => null }));
vi.mock("@/lib/featureGate", () => ({ useCanSeeShop: () => false, resolvePlayerBadges: () => [] }));
vi.mock("@/lib/SocialNotificationsContext", () => ({
  useSocialNotifications: () => ({
    unacknowledgedFriendRequestCount: 0,
    unacknowledgedInvitationCount: 0,
    unacknowledgedRematchCount: 0,
  }),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "electron");
});

describe("Navbar build version", () => {
  it("APP_VERSION includes build number and commit hash", () => {
    // In Next.js, next.config.mjs injects APP_VERSION via the env config.
    // In vitest, the define in vitest.config.mts replicates this.
    // This test guards against the regression where the version string
    // lost its build number during the Vite-to-Next.js migration (#70).
    const version = process.env.APP_VERSION;
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+-build\.\d+\+[a-f0-9]+$/);
  });
});

describe("Navbar desktop actions", () => {
  it("offers guest settings and keeps Quit after the drawer content without fullscreen options", async () => {
    const quit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: { windowControls: { quit } },
    });
    render(
      <Navbar
        auth={null}
        navOpen
        onToggleNav={vi.fn()}
        onCloseNav={vi.fn()}
        onOpenAuth={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/settings");
    const quitButton = await screen.findByRole("button", { name: "Quit Tiao" });
    expect(quitButton.closest("aside")?.lastElementChild).toContainElement(quitButton);
    expect(screen.queryByRole("button", { name: /fullscreen/ })).not.toBeInTheDocument();
    fireEvent.click(quitButton);
    await waitFor(() => expect(quit).toHaveBeenCalledOnce());
  });
});
