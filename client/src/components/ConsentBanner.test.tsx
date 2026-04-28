import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ANALYTICS_CONSENT_STORAGE_KEY, AnalyticsConsentProvider } from "@/lib/AnalyticsConsent";
import { ConsentBanner } from "./ConsentBanner";

// The banner reads openpanel config to decide whether to show at all.
// Real SDK is irrelevant to these tests — stub it as "configured".
vi.mock("@/lib/openpanel", () => ({
  openPanelConfigured: true,
  enableTracking: vi.fn(),
  disableTracking: vi.fn(),
}));

function renderBanner() {
  return render(
    <AnalyticsConsentProvider>
      <ConsentBanner />
    </AnalyticsConsentProvider>,
  );
}

describe("ConsentBanner — dismissal lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("after Accept click, banner unmounts once the exit animation completes", async () => {
    renderBanner();

    // Hydration runs in a post-mount effect; wait for the banner to appear.
    const acceptButton = await screen.findByRole("button", { name: /accept/i });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.click(acceptButton);

    // After the 300ms exit animation the consent status flips to
    // "granted" AND the dismissed flag resets, so the guard returns null
    // and the DOM is gone. Before the fix for the "cookie banner
    // swallows clicks" bug, dismissed never reset and the (invisible)
    // card stayed in the DOM forever, silently eating pointer events at
    // the bottom of the viewport.
    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 1000 },
    );

    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("granted");
  });

  test("after Reject click, banner also unmounts after the exit animation", async () => {
    renderBanner();

    const rejectButton = await screen.findByRole("button", { name: /reject/i });
    fireEvent.click(rejectButton);

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: 1000 },
    );

    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("denied");
  });

  test("does not render when consent is already granted on mount", async () => {
    localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, "granted");
    renderBanner();

    // With status hydrated to "granted" and no pending dismissal in
    // flight, the guard returns null immediately — give the post-mount
    // effect a beat to flush, then confirm the dialog never appears.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
