/**
 * Recovery for a tab whose release can no longer serve a module it needs.
 *
 * The server carries the previous two releases' chunks, so this only fires for
 * a tab older than that, or one that reached a server that has not seen its
 * release yet. Reloading loads one complete, consistent document; tab-local
 * game records restore the board (see tabGameRecovery). A guard stops a loop
 * when the reload itself cannot fix the failure.
 */
const GUARD_KEY = "tiao:release-recovery-at";
const LOOP_GUARD_MS = 30_000;

export function isStaleReleaseError(error: unknown): boolean {
  const value = error as { name?: unknown; message?: unknown } | null;
  const name = typeof value?.name === "string" ? value.name : "";
  const message = typeof value?.message === "string" ? value.message : String(error ?? "");
  return (
    name === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/** Reloads once for a stale-release error; returns whether a reload started. */
export function recoverFromStaleRelease(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleReleaseError(error)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_KEY) ?? 0);
    if (Date.now() - last < LOOP_GUARD_MS) return false;
    window.sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // Without storage the loop guard cannot hold; leave the error visible.
    return false;
  }
  window.location.reload();
  return true;
}

/** A failed release script or stylesheet element, seen in the capture phase. */
export function isStaleReleaseResource(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; src?: string; href?: string } | null;
  if (!element?.tagName) return false;
  const url =
    element.tagName === "SCRIPT" ? element.src : element.tagName === "LINK" ? element.href : "";
  return typeof url === "string" && url.includes("/_next/static/");
}

/**
 * Runs before any chunk: when a document's own release chunks are missing (a
 * server that has not seen this release yet), React never starts, so the
 * component-based guard cannot help. Resources that failed before this script
 * was parsed (stylesheets after a long head) are found on window load, through
 * unloaded stylesheets and Resource Timing status. Same loop guard as
 * recoverFromStaleRelease.
 */
export const RELEASE_RECOVERY_INLINE_SCRIPT = `(function(){var S="/_next/static/";function r(){try{var k=${JSON.stringify(GUARD_KEY)},l=+(sessionStorage.getItem(k)||0);if(Date.now()-l<${LOOP_GUARD_MS})return;sessionStorage.setItem(k,String(Date.now()))}catch(x){return}location.reload()}addEventListener("error",function(e){var t=e.target,u=t&&(t.tagName==="SCRIPT"?t.src:t.tagName==="LINK"?t.href:"");if(u&&u.indexOf(S)>=0)r()},true);addEventListener("load",function(){var i,c=document.querySelectorAll('link[rel="stylesheet"]');for(i=0;i<c.length;i++)if(c[i].href.indexOf(S)>=0&&!c[i].sheet)return r();var p=performance.getEntriesByType("resource");for(i=0;i<p.length;i++)if(p[i].name.indexOf(S)>=0&&p[i].responseStatus>=400)return r()})})();`;
