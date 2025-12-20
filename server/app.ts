import "dotenv/config";
import express from "express";
import path from "path";
import { configureApp } from "./config";
import { connectToDB } from "./db";
import addErrorHandlingToApp from "./error-handling";
import authRoutes from "./routes/auth.routes";
import indexRoutes from "./routes/index.routes";
import userRoutes from "./routes/user.routes";
import { CORRECT_PATH } from "./config/envVars";

connectToDB();

const app = express();

configureApp(app);

app.use("/api", indexRoutes);
app.use("/auth", authRoutes);
app.use("/api", userRoutes);

const clientBuild = path.resolve(CORRECT_PATH, "..", "client", "build");
app.use(express.static(clientBuild));

app.get("*", (_, res) => {
  const indexFile = path.resolve(clientBuild, "index.html");

  res.sendFile(indexFile);
});

addErrorHandlingToApp(app);

export default app;
