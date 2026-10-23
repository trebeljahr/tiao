import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SteamAccountSetup } from "./SteamAccountSetup";

const mocks = vi.hoisted(() => ({
  auth: null as null | { player: { kind: string; displayName: string } },
  profile: undefined as
    | undefined
    | { displayName: string; suggestedUsername: string; avatarUrl?: string },
  finish: vi.fn(),
  skip: vi.fn(),
  openAuth: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({
    auth: mocks.auth,
    authBootstrapped: true,
    steamProfileDefaults: mocks.profile,
    finishSteamSetup: mocks.finish,
    skipSteamSetup: mocks.skip,
    onOpenAuth: mocks.openAuth,
  }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

describe("Steam first-run account choice", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "electron");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = null;
    mocks.profile = undefined;
    mocks.finish.mockResolvedValue(undefined);
  });
  it("does not create an account until the new player chooses a valid username", async () => {
    render(<SteamAccountSetup />);
    expect(mocks.finish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I’m new to Tiao" }));
    const submit = screen.getByRole("button", { name: "Continue with Steam" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Choose your username"), {
      target: { value: "steam-player" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.finish).toHaveBeenCalledWith("create", "steam-player"));
  });
  it("existing players authenticate first and explicitly link the shown account", async () => {
    const view = render(<SteamAccountSetup />);
    fireEvent.click(screen.getByRole("button", { name: "I already play Tiao" }));
    expect(mocks.openAuth).toHaveBeenCalledWith("login");
    expect(mocks.finish).not.toHaveBeenCalled();
    mocks.auth = { player: { kind: "account", displayName: "web-player" } };
    view.rerender(<SteamAccountSetup />);
    expect(screen.getByText("Signed in as web-player")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link Steam to this account" }));
    await waitFor(() => expect(mocks.finish).toHaveBeenCalledWith("link", ""));
  });
  it("keeps a link conflict visible without changing the chosen account", async () => {
    mocks.auth = { player: { kind: "account", displayName: "web-player" } };
    mocks.finish.mockRejectedValue(new Error("Already linked"));
    render(<SteamAccountSetup />);
    fireEvent.click(screen.getByRole("button", { name: "Link Steam to this account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already linked");
    expect(screen.getByText("Signed in as web-player")).toBeInTheDocument();
  });
  it("allows local play without creating or linking an account", () => {
    render(<SteamAccountSetup />);
    fireEvent.click(screen.getByRole("button", { name: "Play without linking" }));
    expect(mocks.skip).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/play");
    expect(mocks.finish).not.toHaveBeenCalled();
  });
  it("keeps native window controls available on the fullscreen first-run screen", async () => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: {
        config: { isSteamBuild: true },
        windowControls: {
          isFullScreen: async () => true,
          onFullScreenChanged: () => () => {},
          setFullScreen: vi.fn(),
          quit: vi.fn(),
        },
      },
    });
    render(<SteamAccountSetup />);
    expect(await screen.findByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quit Tiao" })).toBeInTheDocument();
  });
  it("prefills Steam name and avatar while keeping the username editable", async () => {
    mocks.profile = {
      displayName: "Mäia Jump!",
      suggestedUsername: "maia-jump",
      avatarUrl: "https://avatars.steamstatic.com/fake.jpg",
    };
    const { container } = render(<SteamAccountSetup />);
    expect(screen.getByText("Steam profile: Mäia Jump!")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(mocks.profile.avatarUrl);
    fireEvent.click(screen.getByRole("button", { name: "I’m new to Tiao" }));
    expect(screen.getByLabelText("Choose your username")).toHaveValue("maia-jump");
    fireEvent.change(screen.getByLabelText("Choose your username"), {
      target: { value: "chosen-name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with Steam" }));
    await waitFor(() => expect(mocks.finish).toHaveBeenCalledWith("create", "chosen-name"));
  });
});
