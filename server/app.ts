import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express, { type Router } from "express";
import { auth } from "./auth/auth";
import { configureApp } from "./config";
import addErrorHandlingToApp from "./error-handling";
import { isProxyDraining, isTraefikProbe } from "./lib/readiness";
import { MOBILE_ORIGINS } from "./lib/wsOrigin";
import { nativeAuthCors } from "./middleware/nativeAuthCors";
import achievementRoutes from "./routes/achievement.routes";
import adminRoutes from "./routes/admin.routes";
import appStoreRoutes from "./routes/appStore.routes";
import desktopAuthRoutes from "./routes/desktop-auth.routes";
import discordRoutes from "./routes/discord.routes";
import { createErrorTunnelRouter, errorTunnelTargetFromEnv } from "./routes/errorTunnel.routes";
import gameRoutes from "./routes/game.routes";
import gameAuthRoutes from "./routes/game-auth.routes";
import googlePlayRoutes from "./routes/googlePlay.routes";
import indexRoutes from "./routes/index.routes";
import mobileAuthRoutes from "./routes/mobile-auth.routes";
import previewImageRoutes from "./routes/previewImage.routes";
import reportRoutes from "./routes/report.routes";
import shopRoutes from "./routes/shop.routes";
import socialRoutes from "./routes/social.routes";
import steamAuthRoutes from "./routes/steam-auth.routes";
import storePurchaseRoutes from "./routes/storePurchase.routes";
import tournamentRoutes from "./routes/tournament.routes";

const app = express();

// Traefik's drain probe — ahead of everything, so a request that arrives
// every few seconds skips CORS, logging and the database. It reports only
// whether this container is draining; readiness is the health check Docker
// runs. Traefik sends it straight to this container with an
// X-Hatchkit-Drain header; a visitor's request is forwarded by Traefik,
// which always adds X-Forwarded-For, so a visitor can't pose as it.
app.use((req, res, next) => {
  if (!isTraefikProbe(req.headers)) return next();
  const draining = isProxyDraining();
  res
    .status(draining ? 503 : 200)
    .set("cache-control", "no-store")
    .type("text/plain")
    .send(draining ? "draining\n" : "serving\n");
});

// Desktop OAuth bridge routes run BEFORE both the better-auth catchall
// (so /api/auth/desktop/* takes precedence) and the global CORS
// middleware (desktop clients don't have a stable browser origin, and
// the Electron main process calls /exchange from Node — CORS is
// irrelevant and would break the flow).  They bring their own
// express.json body parser for POST endpoints so there's no
// dependency on configureApp() ordering.
//
// The Capacitor app calls /exchange and /logout with fetch() from its
// WebView origin, so those origins (and only those) get CORS here. No
// credentials: the bridge never reads cookies on those endpoints.
app.use(
  "/api/auth/desktop",
  cors({ origin: [...MOBILE_ORIGINS], credentials: false }),
  express.json({ limit: "10kb" }),
  desktopAuthRoutes,
);

// Discord interactions verify an Ed25519 signature over the raw request
// bytes, so the router parses its own raw body and must sit in front of
// the global express.json().  Both path variants are mounted here by hand
// because mountRouteVariants() is only defined after configureApp().
// When DISCORD_BOT_TOKEN / DISCORD_PUBLIC_KEY are unset the route is a 404.
app.use("/discord", discordRoutes);
app.use("/api/discord", discordRoutes);

// The web client's GlitchTip envelope tunnel (POST /api/_e, and /_e for tabs
// of releases that posted there). Raw body, so it also sits in front of
// express.json(); see routes/errorTunnel.routes.ts.
const errorTunnel = createErrorTunnelRouter(errorTunnelTargetFromEnv());
app.use("/", errorTunnel);
app.use("/api", errorTunnel);

// Account linking for the native apps (system browser + deep link), see
// routes/mobile-auth.routes.ts. Only /link/start is called with fetch().
app.use(
  "/api/auth/mobile",
  cors({ origin: [...MOBILE_ORIGINS], credentials: false }),
  express.json({ limit: "10kb" }),
  mobileAuthRoutes,
);

// Steam's signed ticket is exchanged by Electron main, never by a browser.
app.use("/api/auth/steam", steamAuthRoutes);

// Native mobile apps call better-auth cross-origin with a bearer token.
app.use("/api/auth", nativeAuthCors);

// Mount better-auth BEFORE express.json() to avoid body consumption conflicts
app.all("/api/auth/*splat", toNodeHandler(auth));

configureApp(app);

function mountRouteVariants(basePath: string, router: Router) {
  app.use(basePath, router);

  const apiBasePath = basePath === "/" ? "/api" : `/api${basePath}`;
  app.use(apiBasePath, router);
}

app.get("/", (_, res) => {
  res
    .type("text/plain")
    .send(
      "Tiao API server is running. Start the Vite client in development or deploy the separate frontend service.",
    );
});

// Accept both root-mounted and /api-prefixed paths so the backend can sit
// behind either a direct origin or a path-based reverse proxy without
// forcing the frontend and deployment config to agree on path rewriting.
mountRouteVariants("/", indexRoutes);
mountRouteVariants("/player", gameAuthRoutes);
mountRouteVariants("/", gameRoutes);
mountRouteVariants("/", socialRoutes);
mountRouteVariants("/player/admin", adminRoutes);
mountRouteVariants("/player", reportRoutes);
mountRouteVariants("/", tournamentRoutes);
mountRouteVariants("/shop/iap", storePurchaseRoutes);
mountRouteVariants("/shop/iap/google-play", googlePlayRoutes);
mountRouteVariants("/shop/iap/app-store", appStoreRoutes);
mountRouteVariants("/shop", shopRoutes);
mountRouteVariants("/player", achievementRoutes);
mountRouteVariants("/", previewImageRoutes);

addErrorHandlingToApp(app);

export default app;
