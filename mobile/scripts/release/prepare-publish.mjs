import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildWorkflow, repository, requireMain, validateManifest, validateRun } from "./lib.mjs";

// Download one signed build-mobile.yml artifact, prove its provenance and
// checksums, and hand the store file path to the upload step.
const [target, runId] = process.argv.slice(2);
if (!["android", "ios"].includes(target)) throw new Error("Unknown publish target.");
requireMain(process.env);
if (!/^[1-9]\d*$/.test(runId ?? "")) throw new Error("Provide a numeric source run ID.");
const gh = (args, capture = false) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
const run = JSON.parse(gh(["api", `repos/${repository}/actions/runs/${runId}`], true));
validateRun(run, runId);
// Refuse an existing staging directory so retries cannot mix source runs.
mkdirSync("artifacts");
gh([
  "run",
  "download",
  runId,
  "--repo",
  repository,
  "--pattern",
  `release-${target}-*`,
  "--dir",
  "artifacts",
]);
const manifests = [];
for (const directory of readdirSync("artifacts", { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
)) {
  const path = join("artifacts", directory.name);
  const names = readdirSync(path).filter((name) => /^manifest-[a-z]+-[a-z0-9]+\.json$/.test(name));
  if (names.length !== 1) throw new Error(`Expected exactly one manifest in ${path}`);
  const file = join(path, names[0]);
  gh([
    "attestation",
    "verify",
    file,
    "--repo",
    repository,
    "--signer-workflow",
    `${repository}/.github/workflows/${buildWorkflow}`,
    "--source-ref",
    "refs/heads/main",
    "--source-digest",
    run.head_sha,
    "--deny-self-hosted-runners",
  ]);
  const manifest = JSON.parse(readFileSync(file));
  validateManifest(manifest, run, path);
  manifests.push({ ...manifest, directory: resolve(path), manifest: resolve(file) });
}
if (manifests.length !== 1 || manifests[0].platform !== target)
  throw new Error("Wrong mobile artifact.");
writeFileSync("artifacts/verified.json", JSON.stringify({ run, manifests }, null, 2));
const output = (key, value) => {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const one = (extension) => {
  const files = manifests[0].files.filter((file) => file.name.endsWith(extension));
  if (files.length !== 1) throw new Error(`Expected exactly one ${extension}`);
  return join(manifests[0].directory, files[0].name);
};
output("version", manifests[0].version);
output("build_number", manifests[0].buildNumber);
output("commit", run.head_sha);
output("file", one(target === "android" ? ".aab" : ".ipa"));
if (target === "android") output("mapping", one("-mapping.txt"));
