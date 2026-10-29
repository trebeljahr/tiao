import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeDeepLinkHandler } from "./NativeDeepLinkHandler";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  delete (window as any).electron;
  vi.clearAllMocks();
});

it("routes desktop return hints to the shop, rejects malformed hints, and unsubscribes", () => {
  let returned!: (event: { sessionId?: string; cancelled?: boolean }) => void;
  const unsubscribe = vi.fn();
  (window as any).electron = {
    checkout: {
      onReturn: (cb: typeof returned) => {
        returned = cb;
        return unsubscribe;
      },
    },
  };
  window.history.replaceState({}, "", "/de/play");
  const { unmount } = render(<NativeDeepLinkHandler />);
  act(() => returned({ sessionId: "cs_test_123" }));
  expect(push).toHaveBeenCalledWith("/de/shop?session_id=cs_test_123");
  push.mockClear();
  act(() => returned({ sessionId: "https://attacker.example" }));
  expect(push).not.toHaveBeenCalled();
  act(() => returned({ cancelled: true }));
  expect(push).toHaveBeenCalledWith("/de/shop?cancelled=true");
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
