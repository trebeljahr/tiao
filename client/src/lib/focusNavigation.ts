import type { InputAction } from "./gameInput";

export const FOCUSABLE =
  'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]';

export function focusScope(): HTMLElement {
  const scopes = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  return scopes[scopes.length - 1] ?? document.body;
}

export function focusableElements(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (
      el.tabIndex < 0 ||
      el.matches(":disabled") ||
      el.closest('[inert], [hidden], [aria-hidden="true"]')
    ) {
      return false;
    }
    const style = getComputedStyle(el);
    return (
      style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0
    );
  });
}

export function focusElement(el?: HTMLElement) {
  el?.focus({ preventScroll: true });
  el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export function navigateFocus(action: InputAction) {
  const elements = focusableElements(focusScope());
  const active = document.activeElement as HTMLElement | null;
  const index = active ? elements.indexOf(active) : -1;
  if (index < 0) {
    focusElement(elements[0]);
    return;
  }
  if (action === "next" || action === "previous") {
    focusElement(
      elements[(index + (action === "next" ? 1 : elements.length - 1)) % elements.length],
    );
    return;
  }
  const current = active!.getBoundingClientRect();
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;
  const horizontal = action === "left" || action === "right";
  const sign = action === "left" || action === "up" ? -1 : 1;
  const candidates = elements.flatMap((el) => {
    if (el === active) return [];
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const forward = (horizontal ? dx : dy) * sign;
    const sideways = Math.abs(horizontal ? dy : dx);
    if (forward <= 1) return [];
    return [{ el, score: forward + sideways * 3 }];
  });
  candidates.sort((a, b) => a.score - b.score);
  focusElement(candidates[0]?.el);
}
