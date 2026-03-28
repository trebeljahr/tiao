import "dotenv/config";
import express, { Router } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/auth";
import { configureApp } from "./config";
import addErrorHandlingToApp from "./error-handling";
import gameAuthRoutes from "./routes/game-auth.routes";
import gameRoutes from "./routes/game.routes";
import indexRoutes from "./routes/index.routes";
import socialRoutes from "./routes/social.routes";
import tournamentRoutes from "./routes/tournament.routes";
const app = express();

// Mount better-auth BEFORE express.json() to avoid body consumption conflicts
app.all("/api/auth/*", toNodeHandler(auth));

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
mountRouteVariants("/", tournamentRoutes);

addErrorHandlingToApp(app);

export default app;
