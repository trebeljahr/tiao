import swaggerJsdoc from "swagger-jsdoc";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Tiao API",
      version: "1.0.0",
      description:
        "REST API and WebSocket protocol for Tiao, the open-source multiplayer board game platform.",
    },
    servers: [
      {
        url: "https://tiao.ricos.site/api",
        description: "Production server",
      },
      {
        url: "http://localhost:5005/api",
        description: "Local development server",
      },
    ],
    tags: [
      { name: "Authentication", description: "Guest and account session management" },
      { name: "Profile", description: "Account profile management" },
      { name: "Games", description: "Multiplayer game rooms" },
      { name: "Matchmaking", description: "Automatic opponent pairing" },
      { name: "Social", description: "Friends, friend requests, and game invitations" },
    ],
  },
  apis: [resolve(__dirname, "../routes/*.ts")],
};

const spec = swaggerJsdoc(options) as Record<string, unknown>;
const outputPath = resolve(__dirname, "../../docs-site/static/openapi.json");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(spec, null, 2));

const paths = spec.paths as Record<string, unknown> | undefined;
const components = spec.components as { schemas?: Record<string, unknown> } | undefined;
console.log(`OpenAPI spec written to ${outputPath}`);
console.log(`  Paths: ${Object.keys(paths ?? {}).length}`);
console.log(`  Schemas: ${Object.keys(components?.schemas ?? {}).length}`);
