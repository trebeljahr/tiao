import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { focusableElements, navigateFocus } from "./focusNavigation";

function button(label: string, x: number, y: number, parent = document.body) {
  const el = document.createElement("button");
  el.textContent = label;
  el.getBoundingClientRect = () => ({ left: x, top: y, width: 40, height: 40 }) as DOMRect;
  el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
  parent.append(el);
  return el;
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("controller focus navigation", () => {
  it("moves spatially and falls back to ordered bumper traversal", () => {
    const a = button("A", 0, 0);
    const b = button("B", 50, 0);
    const c = button("C", 0, 50);
    a.focus();
    navigateFocus("right");
    expect(b).toHaveFocus();
    navigateFocus("left");
    expect(a).toHaveFocus();
    navigateFocus("down");
    expect(c).toHaveFocus();
    navigateFocus("next");
    expect(a).toHaveFocus();
    navigateFocus("previous");
    expect(c).toHaveFocus();
  });

  it("excludes disabled, hidden, inert and non-roving cells", () => {
    const enabled = button("Enabled", 0, 0);
    button("Disabled", 50, 0).disabled = true;
    button("Hidden", 100, 0).hidden = true;
    button("Not tab stop", 150, 0).tabIndex = -1;
    button("Inert", 200, 0).setAttribute("inert", "");
    expect(focusableElements(document.body)).toEqual([enabled]);
  });

  it("keeps directional and bumper movement inside the top modal", () => {
    const outside = button("Outside", 0, 0);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    const first = button("First", 50, 0, dialog);
    const last = button("Last", 100, 0, dialog);
    outside.focus();
    navigateFocus("right");
    expect(first).toHaveFocus();
    navigateFocus("next");
    expect(last).toHaveFocus();
    navigateFocus("next");
    expect(first).toHaveFocus();
    navigateFocus("left");
    expect(first).toHaveFocus();
  });
});
