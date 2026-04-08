// Shared helper used by LobbyPage / FriendsPage when the user clicks a
// navbar notification badge. The hash-change listener calls this to:
//   1. Scroll the target element into view with a short ease-out animation
//   2. Wait for the scroll animation to ACTUALLY finish (so the wiggle
//      is visible instead of playing out while the page is still moving)
//   3. Apply the .notification-target-wiggle CSS class, then remove it
//      after the keyframe completes
//
// A few things we CAN'T use, with reasons:
//
//   - Element.scrollIntoView: the LobbyPage wraps its content in an
//     `overflow: hidden` div. scrollIntoView walks up to the first
//     scrollable-ish ancestor (overflow:hidden counts), tries to scroll
//     it, fails silently, and leaves window.scrollY untouched.
//
//   - window.scrollTo({ behavior: "smooth" }) + scrollend: native
//     smooth-scroll support is optional and the scrollend event is
//     opt-in per browser. This leaves us with no reliable "scroll done"
//     signal across browsers.
//
//   - requestAnimationFrame-driven animation: works for real users but
//     is throttled to ~0 Hz in headless/offscreen Chrome, making it
//     untestable in the preview harness and blocking verification.
//
// So we drive the scroll ourselves with setTimeout + instant scrolls.
// setTimeout is not throttled by tab visibility the same way rAF is,
// runs at ~16 ms granularity in normal browsers, and gives us an
// exact promise-based "scroll is done" signal.

const WIGGLE_CLASS = "notification-target-wiggle";
const WIGGLE_DURATION_MS = 1400;
// How far from the top of the viewport to park the target, so a sticky
// navbar / page padding doesn't obscure it.
const TOP_OFFSET_PX = 96;
// Duration of the custom scroll animation. Kept short so the total
// "click badge → wiggle starts" delay stays snappy.
const SCROLL_DURATION_MS = 420;
// If the computed scroll delta is smaller than this, treat it as "no
// scroll needed" and wiggle immediately.
const SCROLL_EPSILON_PX = 2;

function triggerWiggle(el: HTMLElement): void {
  // Removing + forcing reflow + re-adding is required so repeated
  // triggers (user clicks the badge twice) restart the keyframe
  // instead of being a no-op.
  el.classList.remove(WIGGLE_CLASS);
  // Force reflow so the class change is observed.
  void el.offsetWidth;
  el.classList.add(WIGGLE_CLASS);
  window.setTimeout(() => el.classList.remove(WIGGLE_CLASS), WIGGLE_DURATION_MS);
}

function computeTargetScrollY(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  // rect.top is viewport-relative; add current scroll to get the
  // element's document-absolute top, then offset so the element sits
  // below the sticky navbar / page padding instead of being jammed
  // against the window's top edge.
  const docTop = rect.top + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.max(0, Math.min(maxScroll, docTop - TOP_OFFSET_PX));
}

// Cubic ease-out — matches the feel of a smooth scrollIntoView.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animateScrollTo(targetY: number, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const startY = window.scrollY;
    const delta = targetY - startY;
    if (Math.abs(delta) < SCROLL_EPSILON_PX || durationMs <= 0) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      resolve();
      return;
    }
    const startTime = Date.now();
    const step = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const y = startY + delta * easeOutCubic(t);
      // Use `behavior: "instant"` explicitly so we never race against
      // the browser's own smooth-scroll animation (which stacks badly
      // with our per-tick jumps and breaks in headless Chrome).
      window.scrollTo({ top: y, behavior: "instant" });
      if (t < 1) {
        window.setTimeout(step, 16);
      } else {
        resolve();
      }
    };
    step();
  });
}

/**
 * Scroll `el` into view with an ease-out animation, then — only after
 * the scroll has actually finished — play the
 * notification-target-wiggle animation. Safe to call from a hashchange
 * handler.
 *
 * When `wiggleTargets` is provided, the wiggle class is applied to those
 * elements instead of the scrolled container itself. This is used by the
 * friend-requests and invitations lists, which want the whole list to
 * scroll into view but only the *new* (unacknowledged) item(s) to shake —
 * otherwise every existing request shakes in sympathy, which looks noisy
 * and falsely implies that every item is a fresh one.
 */
export function scrollToAndWiggle(el: HTMLElement, wiggleTargets?: HTMLElement[]): void {
  const target = computeTargetScrollY(el);
  void animateScrollTo(target, SCROLL_DURATION_MS).then(() => {
    const elementsToWiggle = wiggleTargets && wiggleTargets.length > 0 ? wiggleTargets : [el];
    for (const target of elementsToWiggle) {
      triggerWiggle(target);
    }
  });
}
