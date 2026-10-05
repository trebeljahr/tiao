"use client";

import { useEffect } from "react";
import { isStaleReleaseResource, recoverFromStaleRelease } from "@/lib/releaseRecovery";

/** Reloads once when this tab's release can no longer load one of its modules. */
export function ReleaseRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent | Event) => {
      if (event instanceof ErrorEvent) {
        recoverFromStaleRelease(event.error ?? event.message);
      } else if (isStaleReleaseResource(event.target)) {
        recoverFromStaleRelease({ name: "ChunkLoadError" });
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      recoverFromStaleRelease(event.reason);
    };
    // Capture phase: resource load errors do not bubble to window.
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
