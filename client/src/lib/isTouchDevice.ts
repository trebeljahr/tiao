export const IS_TOUCH_DEVICE =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
