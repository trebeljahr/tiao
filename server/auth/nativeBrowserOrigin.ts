import type { Request, Response } from "express";
import { auth } from "./auth";

/** Keep native bridge cookies on the host used by the provider's callback. */
export async function redirectNativeBrowserToAuthOrigin(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const { baseURL } = await auth.$context;
  const origin = new URL(baseURL);
  if (req.host === origin.host && req.protocol === origin.protocol.slice(0, -1)) return false;

  // Only the configured auth origin chooses the destination. Preserve the
  // native state, PKCE challenge, or unopened link ticket across this hop.
  res.redirect(`${origin.origin}${req.originalUrl}`);
  return true;
}
