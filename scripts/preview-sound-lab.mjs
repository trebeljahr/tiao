/** Self-contained preview of the real game components. No backend or locale proxy. */
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = path.join(root, "client");
const directory = mkdtempSync(path.join(tmpdir(), "tiao-sound-lab-"));
const specifiedPort = process.env.PORT;
let port;
for (let attempt = 0; attempt < 3; attempt++) {
  const candidate = specifiedPort ? Number(specifiedPort) : randomInt(49152, 65536);
  if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535 || candidate === 3411)
    throw new Error("Choose an available non-reserved port.");
  const available = await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  if (available) {
    port = candidate;
    break;
  }
  if (specifiedPort) break;
}
if (!port) {
  rmSync(directory, { recursive: true, force: true });
  throw new Error("No free preview port found.");
}

const source = (relative) => JSON.stringify(path.join(client, relative));
writeFileSync(
  path.join(directory, "index.html"),
  '<html><head><title>Tiao UI sound lab</title><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
);
writeFileSync(
  path.join(directory, "main.tsx"),
  `
import React from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import messages from ${source("messages/en.json")};
import { SoundLabPage } from ${source("src/views/SoundLabPage.tsx")};
import ${source("app/[locale]/globals.css")};
createRoot(document.getElementById("root")!).render(<NextIntlClientProvider locale="en" timeZone="Australia/Sydney" messages={messages}><SoundLabPage /></NextIntlClientProvider>);
`,
);
writeFileSync(
  path.join(directory, "navigation.tsx"),
  'import React from "react"; export const Link = ({children, href, ...props}) => <a href={href} {...props}>{children}</a>;',
);
symlinkSync(path.join(client, "node_modules"), path.join(directory, "node_modules"), "dir");
const aliases = [
  { find: "@/i18n/navigation", replacement: path.join(directory, "navigation.tsx") },
  { find: "@shared", replacement: path.join(root, "shared/src/index.ts") },
  { find: "@", replacement: path.join(client, "src") },
  ...["react-dom/client", "react-dom", "react/jsx-dev-runtime", "react/jsx-runtime"].map(
    (name) => ({
      find: name,
      replacement: path.join(
        client,
        "node_modules",
        `${name === "react-dom" ? "react-dom/index" : name}.js`,
      ),
    }),
  ),
];
writeFileSync(
  path.join(directory, "vite.config.mjs"),
  `export default {
 define: { "process.env": JSON.stringify({ NODE_ENV: "development", APP_VERSION: "sound-lab" }) },
 publicDir: ${source("public")},
 esbuild: {jsx: "automatic"}, css: {postcss: ${JSON.stringify(client)}},
 resolve: {alias: [...${JSON.stringify(aliases)}, {find: /^react$/, replacement: ${source("node_modules/react/index.js")}}]},
 server: {fs: {allow: [${JSON.stringify(directory)}, ${JSON.stringify(root)}, ${JSON.stringify(realpathSync(path.join(client, "node_modules")))}]}}
};`,
);
const child = spawn(
  path.join(client, "node_modules/.bin/vite"),
  [
    directory,
    "--config",
    path.join(directory, "vite.config.mjs"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: client, stdio: "inherit" },
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (!stopping) {
      stopping = true;
      child.kill(signal);
    }
  });
child.once("error", (error) => {
  console.error(error.message);
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = 1;
});
child.once("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = stopping ? 0 : (code ?? 1);
});
