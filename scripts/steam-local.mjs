#!/usr/bin/env node
// Local SteamPipe workflow, following Mesozoic Protocol's staging contract.
// Writes only .steam-local/<target>; never uploads or changes Steam client settings.
import { spawnSync } from "node:child_process";
import { constants, createReadStream, existsSync } from "node:fs";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPackagedChannel, compareVersions, minElectronBuilder, steamProduct } from "../desktop/scripts/release/lib.mjs";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORMS = ["windows", "macos", "linux"];
export function workRoot(target, repo = REPO) {
  steamProduct(target);
  return join(repo, ".steam-local", target);
}
function knownPlatforms(platforms) {
  if (!platforms.length || new Set(platforms).size !== platforms.length || platforms.some(p => !PLATFORMS.includes(p))) {
    throw Error("Choose one or more known platforms: windows, macos, linux");
  }
}
function quote(value) {
  const text = String(value).replaceAll("\\", "/");
  if (/[\r\n\0]/.test(text)) throw Error("VDF value contains a control character");
  return JSON.stringify(text);
}
export function renderAppVdf(target, platforms, root) {
  knownPlatforms(platforms);
  const product = steamProduct(target);
  const depots = platforms.map(p => `${quote(product.depots[p])} ${quote(`depot_${p}.vdf`)}`).join("\n");
  return `"appbuild" { "appid" ${quote(product.appId)} "desc" ${quote(product.productName + " local development")} "buildoutput" ${quote(join(root,"build-output"))} "contentroot" ${quote(join(root,"depots"))} "local" ${quote(join(root,"htdocs"))} "setlive" "" "preview" "0" "depots" { ${depots} } }\n`;
}
export function renderDepotVdf(target, platform) {
  knownPlatforms([platform]);
  return `"DepotBuildConfig" { "DepotID" ${quote(steamProduct(target).depots[platform])} "ContentRoot" ${quote(platform)} "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" } "FileExclusion" "steam_appid.txt" "FileExclusion" "*.pdb" "FileExclusion" "*.dSYM" "FileExclusion" ".DS_Store" }\n`;
}
async function nonempty(path) {
  const info = await stat(path);
  if (!info.isFile() || !info.size) throw Error(`Missing or empty file: ${path}`);
}
export async function verifyDepot(target, platform, depot) {
  knownPlatforms([platform]);
  const product = steamProduct(target);
  let resources, executable;
  if (platform === "macos") {
    const entries = await readdir(depot);
    const appName = product.productName + ".app";
    if (entries.length !== 1 || entries[0] !== appName) throw Error(`macOS depot must contain only ${appName}`);
    resources = join(depot, appName, "Contents", "Resources");
    executable = join(depot, appName, "Contents", "MacOS", product.productName);
  } else {
    resources = join(depot,"resources");
    executable = join(depot, platform === "windows" ? product.productName + ".exe" : target === "steam-demo" ? "tiao-demo" : "tiao");
  }
  await nonempty(executable);
  if (platform !== "windows") await access(executable, constants.X_OK);
  assertPackagedChannel(join(resources,"app.asar"),target);
  await nonempty(join(resources,"client-bundle","en","index.html"));
  const files = await readdir(depot,{recursive:true,withFileTypes:true});
  if (files.some(e => e.isFile() && /^(steam_appid\.txt|\.env(?:\..*)?|reviewer-credentials\.json)$|\.(dmg|AppImage|pdb)$/i.test(e.name))) {
    throw Error("Depot contains a development ID, credential file, installer, or debug file");
  }
  const nativeName = {macos:"libsteam_api.dylib",windows:"steam_api64.dll",linux:"libsteam_api.so"}[platform];
  if (!files.some(e => e.isFile() && e.name === nativeName)) throw Error(`Missing Steam native library: ${nativeName}`);
  return depot;
}
export async function stage(target, platform, source, root = workRoot(target)) {
  const input = await realpath(source);
  knownPlatforms([platform]);
  const parent = join(root,"depots");
  await mkdir(parent,{recursive:true});
  const output = join(await realpath(parent),platform);
  if (input === output || input.startsWith(output + sep) || output.startsWith(input + sep)) throw Error("Source overlaps local output");
  const temporary = await mkdtemp(join(parent, ".stage-"));
  try {
    if (platform === "macos") {
      if (basename(input) !== steamProduct(target).productName + ".app") throw Error("Select the matching game .app");
      await cp(input,join(temporary,basename(input)),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
    } else {
      await cp(input,temporary,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
    }
    await verifyDepot(target,platform,temporary);
    await rm(output,{recursive:true,force:true});
    await rename(temporary,output);
    return output;
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
export async function prepare(target, platforms, root = workRoot(target), port = 52871) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Use a port between 1024 and 65535");
  knownPlatforms(platforms);
  for (const platform of platforms) await verifyDepot(target,platform,join(root,"depots",platform));
  for (const directory of ["scripts","htdocs","build-output"]) await mkdir(join(root,directory),{recursive:true});
  for (const platform of platforms) await writeFile(join(root,"scripts",`depot_${platform}.vdf`),renderDepotVdf(target,platform));
  const path = join(root,"scripts","app_build_local.vdf");
  await writeFile(path,renderAppVdf(target,platforms,root));
  await writeFile(join(root,"steam_dev.cfg"),`@LocalContentServer "127.0.0.1:${port}"\n`);
  await writeFile(join(root,"local.json"),JSON.stringify({target,port,platforms},null,2)+"\n");
  return path;
}
export function makeServer(root) {
  const htdocs = join(root,"htdocs");
  return createServer(async (request,response) => {
    try {
      if (!["GET","HEAD"].includes(request.method)) { response.writeHead(405,{Allow:"GET, HEAD"}).end(); return; }
      const decoded = decodeURIComponent(new URL(request.url,"http://127.0.0.1").pathname);
      if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").includes("..")) { response.writeHead(400).end(); return; }
      const path = join(htdocs,decoded);
      const actual = await realpath(path);
      const actualRoot = await realpath(htdocs);
      if (!actual.startsWith(actualRoot + sep)) { response.writeHead(404).end(); return; }
      const info = await lstat(path);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200,{"Content-Length":info.size,"Content-Type":"application/octet-stream"});
      if (request.method === "HEAD") response.end(); else createReadStream(path).on("error",()=>response.destroy()).pipe(response);
    } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 400).end(); }
  });
}
function run(command,args,options={}) {
  const result = spawnSync(command,args,{cwd:REPO,stdio:"inherit",...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited ${result.status ?? result.signal}`);
}
function option(args,name,fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i+1] || args[i+1].startsWith("--")) throw Error(`${name} needs a value`);
  return args[i+1];
}
async function main() {
  const [command,...args] = process.argv.slice(2);
  const target = option(args,"--target","steam-demo");
  const product = steamProduct(target);
  const root = workRoot(target);
  const platform = option(args,"--platform",{darwin:"macos",win32:"windows",linux:"linux"}[process.platform]);
  knownPlatforms([platform]);
  if (command === "build") {
    if (platform !== ({darwin:"macos",win32:"windows",linux:"linux"}[process.platform])) throw Error("Local build uses the host OS; use stage for CI artifacts");
    const releaseEnv = join(REPO,"desktop",".env.release");
    if (existsSync(releaseEnv)) process.loadEnvFile(releaseEnv);
    const signed = args.includes("--signed") || process.env.TIAO_SIGNED === "1";
    if (signed && platform === "macos" && !process.env.APPLE_KEYCHAIN_PROFILE &&
      !(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) &&
      !(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)) {
      throw Error("Local notarization needs APPLE_KEYCHAIN_PROFILE or complete Apple API/Apple ID credentials in desktop/.env.release. Hosted signed builds can be staged without local credentials.");
    }
    const require = createRequire(join(REPO,"desktop","package.json"));
    const installed = require("electron-builder/package.json").version;
    if (compareVersions(installed,minElectronBuilder) < 0) throw Error(`Install locked desktop dependencies first; electron-builder ${minElectronBuilder}+ required (found ${installed})`);
    if (signed && platform !== "macos") throw Error("Signed Windows builds use hosted Azure OIDC CI; stage its verified artifacts. Linux uses CI provenance.");
    run("npm",["--prefix","desktop","run","dev:build-client"]);
    const env = {...process.env,TIAO_DISTRIBUTION_CHANNEL:target,TIAO_SIGNED:signed?"1":"0",CSC_IDENTITY_AUTO_DISCOVERY:signed?"true":"false"};
    run(process.execPath,[require.resolve("electron-builder/cli.js"),"--config","electron-builder.config.cjs","--"+{macos:"mac",windows:"win",linux:"linux"}[platform],"--publish","never"],{cwd:join(REPO,"desktop"),env});
    const output = join(REPO,"desktop","dist",target,{macos:"mac-universal",windows:"win-unpacked",linux:"linux-unpacked"}[platform]);
    const source = platform === "macos" ? join(output,product.productName+".app") : output;
    if (signed) run("bash",["desktop/scripts/release/verify-app-macos.sh",source]);
    console.log(`Staged ${await stage(target,platform,source,root)}`);
  } else if (command === "stage") {
    const source = option(args,"--source");
    if (!source) throw Error("stage requires --source <app or unpacked directory>");
    console.log(`Staged ${await stage(target,platform,source,root)}`);
  } else if (command === "prepare") {
    const platforms = args.flatMap((arg,i) => arg === "--platform" ? [args[i+1]] : []);
    console.log(`Local build VDF: ${await prepare(target,platforms.length?platforms:[platform],root,Number(option(args,"--port","52871")))}`);
    console.log(`Steam client config, not installed: ${join(root,"steam_dev.cfg")}`);
  } else if (command === "serve") {
    const config = JSON.parse(await readFile(join(root,"local.json"),"utf8"));
    const server = makeServer(root);
    server.on("error",error=>{ console.error(error.message); process.exitCode=1; });
    server.listen(config.port,"127.0.0.1",()=>console.log(`Serving ${root}/htdocs at http://127.0.0.1:${config.port}`));
  } else throw Error("Usage: steam-local.mjs build [--signed] | stage --source <path> | prepare [--port 52871] | serve [--target steam|steam-demo] [--platform macos|windows|linux]");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
