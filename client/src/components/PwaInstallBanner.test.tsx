import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PwaInstallBanner } from "./PwaInstallBanner";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function dispatchBeforeInstallPrompt() {
  const event = new Event("beforeinstallprompt") as Event & {
    platforms: string[];
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  };
  Object.defineProperty(event, "platforms", { value: ["web"] });
  Object.defineProperty(event, "prompt", { value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(event, "userChoice", {
    value: Promise.resolve({ outcome: "accepted" as const, platform: "web" }),
  });
  window.dispatchEvent(event);
}

describe("PwaInstallBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not render when no install event has fired", () => {
    const { container } = render(<PwaInstallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders install and dismiss buttons once beforeinstallprompt fires", () => {
    render(<PwaInstallBanner />);

    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("description")).toBeInTheDocument();
    expect(screen.getByText("install")).toBeInTheDocument();
    expect(screen.getByText("dismiss")).toBeInTheDocument();
  });

  it("hides the banner after the user clicks dismiss", () => {
    const { container } = render(<PwaInstallBanner />);

    act(() => {
      dispatchBeforeInstallPrompt();
    });

    act(() => {
      screen.getByText("dismiss").click();
    });

    expect(container.firstChild).toBeNull();
  });
});
