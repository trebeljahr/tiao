import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CLASSIC } from "./boardThemes";
import { MobilePreviewLayer } from "./MobilePreviewLayer";
import { gridMetrics, pointPercent } from "./tiaoBoardHelpers";

const m = gridMetrics(19);
const props = {
  mobilePreview: { x: 9, y: 9 },
  mobilePreviewVisible: true,
  mobilePreviewDragging: false,
  mobilePreviewValid: true,
  invalidShake: null,
  theme: CLASSIC,
  m,
  pp: (index: number) => pointPercent(index, m.gridStart, m.gridStep),
  cellPercent: 100 / 19,
  currentTurn: "white" as const,
};

async function nextFrames() {
  await act(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

describe("mobile ghost alignment", () => {
  it("keeps the centering transform after the motion animation runs", async () => {
    render(<MobilePreviewLayer {...props} />);
    await nextFrames();
    expect(screen.getByTestId("mobile-preview-loupe")).toHaveStyle({
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%) scale(1)",
    });
  });

  it("keeps centering through dragging and repeated invalid-placement shakes", async () => {
    const { rerender } = render(<MobilePreviewLayer {...props} />);
    const ghost = screen.getByTestId("mobile-preview-loupe");
    for (const nonce of [1, 2]) {
      rerender(
        <MobilePreviewLayer
          {...props}
          mobilePreviewDragging
          mobilePreviewValid={false}
          invalidShake={{ key: "9-9", nonce }}
        />,
      );
      await nextFrames();
      expect(screen.getByTestId("mobile-preview-loupe")).toBe(ghost);
      expect(ghost).toHaveStyle({ transform: "translate(-50%, -50%) scale(1)" });
    }
    rerender(<MobilePreviewLayer {...props} mobilePreview={{ x: 5, y: 6 }} />);
    await nextFrames();
    expect(ghost).toHaveStyle({
      left: `${props.pp(5)}%`,
      top: `${props.pp(6)}%`,
      transform: "translate(-50%, -50%) scale(1)",
    });
  });
});
