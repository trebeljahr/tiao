import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppInfoSettings } from "./AppInfoSettings";
import { LobbyFooter } from "./GameCredits";
import { Navbar } from "./Navbar";

vi.mock("@/lib/SocialNotificationsContext", () => ({
  useSocialNotifications: () => ({
    unacknowledgedFriendRequestCount: 0,
    unacknowledgedInvitationCount: 0,
    unacknowledgedRematchCount: 0,
  }),
}));

const props = {
  auth: null,
  navOpen: true,
  onToggleNav: vi.fn(),
  onCloseNav: vi.fn(),
  onOpenAuth: vi.fn(),
  onLogout: vi.fn(),
};

type AppWindow = { electron?: unknown; Capacitor?: unknown };

function setPlatform(platform: string) {
  if (platform === "steam") {
    (window as unknown as AppWindow).electron = { config: { isSteamBuild: true } };
  } else if (platform !== "web") {
    (window as unknown as AppWindow).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => platform,
    };
  }
}

afterEach(() => {
  delete (window as unknown as AppWindow).electron;
  delete (window as unknown as AppWindow).Capacitor;
  vi.clearAllMocks();
});

describe.each(["steam", "ios", "android"])("%s information in Settings", (platform) => {
  it("keeps information out of the drawer and lobby while Settings stays reachable for guests", () => {
    setPlatform(platform);
    render(
      <>
        <Navbar {...props} />
        <LobbyFooter />
      </>,
    );
    const drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("link", { name: "Settings" }));
    expect(props.onCloseNav).toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "About" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Report an Issue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("preserves credits and every information destination in Settings", () => {
    setPlatform(platform);
    render(<AppInfoSettings />);
    expect(screen.getByRole("heading", { name: "About Tiao" })).toBeInTheDocument();
    for (const [name, href] of [
      ["About", "/about"],
      ["Press", "/press"],
      ["Imprint", "/impressum"],
      ["Privacy policy", "/privacy"],
      ["Report an Issue", "https://github.com/trebeljahr/tiao/issues/new/choose"],
      ["Andreas Edmeier", "/creators/andreas"],
      ["Rico Trebeljahr", "/creators/rico"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByText(`v${process.env.APP_VERSION}`)).toBeInTheDocument();
  });
});

it("keeps the web drawer and lobby footer, with no duplicate Settings section", () => {
  render(
    <>
      <Navbar {...props} />
      <LobbyFooter />
      <AppInfoSettings />
    </>,
  );
  expect(screen.getByRole("link", { name: "Report an Issue" })).toBeInTheDocument();
  expect(screen.getByRole("contentinfo")).toHaveTextContent("Andreas Edmeier");
  expect(screen.queryByRole("heading", { name: "About Tiao" })).not.toBeInTheDocument();
});
