import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SteamWindowControls } from "./SteamWindowControls";

const electronWindow = window as unknown as { electron?: unknown };
afterEach(() => {
  cleanup();
  delete electronWindow.electron;
});

function installBridge(isSteamBuild = true) {
  let onChange = (_enabled: boolean) => {};
  const unsubscribe = vi.fn();
  const controls = {
    isFullScreen: vi.fn().mockResolvedValue(true),
    setFullScreen: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    onFullScreenChanged: vi.fn((cb: (enabled: boolean) => void) => {
      onChange = cb;
      return unsubscribe;
    }),
  };
  electronWindow.electron = { config: { isSteamBuild }, windowControls: controls };
  return { controls, unsubscribe, change: (enabled: boolean) => act(() => onChange(enabled)) };
}

describe("Steam window controls", () => {
  it("stays hidden on web, other desktop channels, and older preloads", () => {
    const { rerender } = render(<SteamWindowControls />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    installBridge(false);
    rerender(<SteamWindowControls key="direct" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    electronWindow.electron = { config: { isSteamBuild: true } };
    rerender(<SteamWindowControls key="old" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("toggles native fullscreen, follows native state changes, quits, and unsubscribes", async () => {
    const { controls, change, unsubscribe } = installBridge();
    const { unmount } = render(<SteamWindowControls />);
    fireEvent.click(await screen.findByRole("button", { name: "Exit fullscreen" }));
    expect(controls.setFullScreen).toHaveBeenCalledWith(false);
    change(false);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(controls.setFullScreen).toHaveBeenLastCalledWith(true);
    change(true);
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quit Tiao" }));
    await waitFor(() => expect(controls.quit).toHaveBeenCalledOnce());
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports a failed action without falsely changing fullscreen state", async () => {
    const { controls } = installBridge();
    controls.setFullScreen.mockRejectedValue(new Error("IPC failed"));
    render(<SteamWindowControls />);
    fireEvent.click(await screen.findByRole("button", { name: "Exit fullscreen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Could not complete this action");
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
  });
});
