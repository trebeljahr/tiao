import { useCallback, useRef, useState } from "react";

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const DOUBLE_TAP_THRESHOLD = 300; // ms
const PAN_THRESHOLD = 8; // px movement before entering pan mode

type Point = { x: number; y: number };

function getTouchDistance(t1: React.Touch, t2: React.Touch): number {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchMidpoint(t1: React.Touch, t2: React.Touch): Point {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

function clampTranslate(
  tx: number,
  ty: number,
  scale: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const maxTx = (width * (scale - 1)) / 2;
  const maxTy = (height * (scale - 1)) / 2;
  return {
    x: Math.max(-maxTx, Math.min(maxTx, tx)),
    y: Math.max(-maxTy, Math.min(maxTy, ty)),
  };
}

export type UsePinchZoomOptions = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  panDisabled?: boolean;
};

export function usePinchZoom({ containerRef, panDisabled }: UsePinchZoomOptions) {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Gesture tracking refs
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const pinchStartMidpoint = useRef<Point | null>(null);
  const pinchStartTranslate = useRef<Point>({ x: 0, y: 0 });
  const pinchStartCenter = useRef<Point | null>(null);

  const panStartPoint = useRef<Point | null>(null);
  const panStartTranslate = useRef<Point>({ x: 0, y: 0 });
  const isPanningRef = useRef(false);

  const lastTapTime = useRef(0);
  const gestureActiveRef = useRef(false);
  const touchCountRef = useRef(0);

  // Use refs for current values in gesture callbacks (avoids stale closures)
  const scaleRef = useRef(1);
  const translateXRef = useRef(0);
  const translateYRef = useRef(0);

  const isZoomed = scale > 1.05;

  const updateTransform = useCallback(
    (newScale: number, newTx: number, newTy: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // rect is the visual (transformed) rect — divide by current scale to get original dims
      const currentScale = scaleRef.current || 1;
      const clamped = clampTranslate(
        newTx,
        newTy,
        newScale,
        rect.width / currentScale,
        rect.height / currentScale,
      );
      scaleRef.current = newScale;
      translateXRef.current = clamped.x;
      translateYRef.current = clamped.y;
      setScale(newScale);
      setTranslateX(clamped.x);
      setTranslateY(clamped.y);
    },
    [containerRef],
  );

  const resetZoom = useCallback(() => {
    setIsAnimating(true);
    scaleRef.current = 1;
    translateXRef.current = 0;
    translateYRef.current = 0;
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    setTimeout(() => setIsAnimating(false), 260);
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE) return;
      touchCountRef.current = e.touches.length;

      if (e.touches.length >= 2) {
        // Pinch start
        e.preventDefault();
        gestureActiveRef.current = true;
        pinchStartDistance.current = getTouchDistance(e.touches[0], e.touches[1]);
        pinchStartScale.current = scaleRef.current;
        pinchStartMidpoint.current = getTouchMidpoint(e.touches[0], e.touches[1]);
        pinchStartTranslate.current = {
          x: translateXRef.current,
          y: translateYRef.current,
        };
        // Save the visual center at gesture start so we don't re-read it
        // from gBCR during the gesture (which would drift as transform updates)
        const rect = containerRef.current?.getBoundingClientRect();
        pinchStartCenter.current = rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;
        isPanningRef.current = false;
        panStartPoint.current = null;
        setIsAnimating(false);
      } else if (e.touches.length === 1 && scaleRef.current > 1.05 && !panDisabled) {
        // Potential pan start
        panStartPoint.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        panStartTranslate.current = {
          x: translateXRef.current,
          y: translateYRef.current,
        };
        isPanningRef.current = false;
      } else {
        panStartPoint.current = null;
        isPanningRef.current = false;
      }
    },
    [panDisabled, containerRef],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE) return;

      // Pinch
      if (
        e.touches.length >= 2 &&
        pinchStartDistance.current !== null &&
        pinchStartMidpoint.current !== null
      ) {
        e.preventDefault();
        const newDist = getTouchDistance(e.touches[0], e.touches[1]);
        const ratio = newDist / pinchStartDistance.current;
        const newScale = clampScale(pinchStartScale.current * ratio);

        // Zoom toward pinch midpoint: adjust translate so midpoint stays fixed.
        // Use the center saved at gesture start — re-reading gBCR here would
        // use the already-shifted center, creating a feedback loop that drifts.
        if (pinchStartCenter.current) {
          const mid = pinchStartMidpoint.current;
          const cx = pinchStartCenter.current.x;
          const cy = pinchStartCenter.current.y;
          const offsetX = mid.x - cx;
          const offsetY = mid.y - cy;

          const scaleChange = newScale / pinchStartScale.current;
          const newTx = pinchStartTranslate.current.x - offsetX * (scaleChange - 1);
          const newTy = pinchStartTranslate.current.y - offsetY * (scaleChange - 1);
          updateTransform(newScale, newTx, newTy);
        }
        return;
      }

      // Pan
      if (panStartPoint.current && e.touches.length === 1) {
        const dx = e.touches[0].clientX - panStartPoint.current.x;
        const dy = e.touches[0].clientY - panStartPoint.current.y;

        if (!isPanningRef.current && Math.hypot(dx, dy) > PAN_THRESHOLD) {
          isPanningRef.current = true;
          gestureActiveRef.current = true;
        }

        if (isPanningRef.current) {
          e.preventDefault();
          updateTransform(
            scaleRef.current,
            panStartTranslate.current.x + dx,
            panStartTranslate.current.y + dy,
          );
        }
      }
    },
    [containerRef, updateTransform],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!IS_TOUCH_DEVICE) return;
      const remainingTouches = e.touches.length;

      // End pinch
      if (pinchStartDistance.current !== null && remainingTouches < 2) {
        pinchStartDistance.current = null;
        pinchStartMidpoint.current = null;
        // Snap to 1 if barely zoomed
        if (scaleRef.current < 1.05) {
          resetZoom();
        }
        // Delay clearing gesture flag so the following tap doesn't fire
        setTimeout(() => {
          gestureActiveRef.current = false;
        }, 50);
        return;
      }

      // End pan
      if (isPanningRef.current) {
        isPanningRef.current = false;
        panStartPoint.current = null;
        setTimeout(() => {
          gestureActiveRef.current = false;
        }, 50);
        return;
      }

      panStartPoint.current = null;

      // Double-tap to reset zoom (only when zoomed)
      if (remainingTouches === 0 && touchCountRef.current === 1 && scaleRef.current > 1.05) {
        const now = Date.now();
        if (now - lastTapTime.current < DOUBLE_TAP_THRESHOLD) {
          resetZoom();
          lastTapTime.current = 0;
          gestureActiveRef.current = true;
          setTimeout(() => {
            gestureActiveRef.current = false;
          }, 50);
          return;
        }
        lastTapTime.current = now;
      }
    },
    [resetZoom],
  );

  const transformStyle =
    scale === 1 && translateX === 0 && translateY === 0
      ? undefined
      : `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`;

  return {
    scale,
    translateX,
    translateY,
    isZoomed,
    isGesturing: gestureActiveRef.current,
    gestureActiveRef,
    transformStyle,
    isAnimating,
    resetZoom,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
