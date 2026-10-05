/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

// Tell TypeScript about the precache manifest injected by Serwist at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Router flight data (RSC) belongs to exactly one release. A cached payload
// from an older release could reference modules the page no longer has, so it
// always goes to the network; a 409 from the server then reloads the document.
const isFlightRequest = ({ request }: { request: Request }) =>
  request.headers.get("RSC") === "1" ||
  request.headers.has("Next-Router-Prefetch") ||
  request.headers.has("Next-Action");

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [{ matcher: isFlightRequest, handler: new NetworkOnly() }, ...defaultCache],
});

serwist.addEventListeners();
