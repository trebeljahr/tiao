import "dotenv/config";
import { toNodeHandler } from "better-auth/node";
import express, { type Router } from "express";
import { auth } from "./auth/auth";
import { configureApp } from "./config";
import addErrorHandlingToApp from "./error-handling";
import achievementRoutes from "./routes/achievement.routes";
import adminRoutes from "./routes/admin.routes";
import desktopAuthRoutes from "./routes/desktop-auth.routes";
import discordRoutes from "./routes/discord.routes";
import gameRoutes from "./routes/game.routes";
import gameAuthRoutes from "./routes/game-auth.routes";
import indexRoutes from "./routes/index.routes";
import reportRoutes from "./routes/report.routes";
import shopRoutes from "./routes/shop.routes";
import socialRoutes from "./routes/social.routes";
import tournamentRoutes from "./routes/tournament.routes";

const app = express();

// Desktop OAuth bridge routes run BEFORE both the better-auth catchall
// (so /api/auth/desktop/* takes precedence) and the global CORS
// middleware (desktop clients don't have a stable browser origin, and
// the Electron main process calls /exchange from Node — CORS is
// irrelevant and would break the flow).  They bring their own
// express.json body parser for POST endpoints so there's no
// dependency on configureApp() ordering.
app.use("/api/auth/desktop", express.json({ limit: "10kb" }), desktopAuthRoutes);

// Discord interactions verify an Ed25519 signature over the raw request
// bytes, so the router parses its own raw body and must sit in front of
// the global express.json().  Both path variants are mounted here by hand
// because mountRouteVariants() is only defined after configureApp().
// When DISCORD_BOT_TOKEN / DISCORD_PUBLIC_KEY are unset the route is a 404.
app.use("/discord", discordRoutes);
app.use("/api/discord", discordRoutes);

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
mountRouteVariants("/shop", shopRoutes);
mountRouteVariants("/player", achievementRoutes);

addErrorHandlingToApp(app);

export default app;
