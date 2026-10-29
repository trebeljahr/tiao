import { type RefObject, useEffect, useRef } from "react";
import { focusableElements, focusElement, focusScope } from "@/lib/focusNavigation";

/** Trap focus in the top modal and restore its invoker on close. */
export function useFocusScope(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  dismiss?: () => void,
) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const scope = ref.current;
    if (!open || !scope) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusElement(focusableElements(scope)[0] ?? scope);
    function onKeyDown(event: KeyboardEvent) {
      if (focusScope() !== scope || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissRef.current?.();
      } else if (event.key === "Tab") {
        const elements = focusableElements(scope!);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (
          elements.length === 0 ||
          (event.shiftKey ? index <= 0 : index < 0 || index === elements.length - 1)
        ) {
          event.preventDefault();
          focusElement(elements[event.shiftKey ? elements.length - 1 : 0] ?? scope!);
        }
      }
    }
    function onFocus(event: FocusEvent) {
      if (focusScope() === scope && !scope!.contains(event.target as Node)) {
        focusElement(focusableElements(scope!)[0] ?? scope!);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
      if (previous?.isConnected && !previous.matches(":disabled")) focusElement(previous);
    };
  }, [open, ref]);
}
