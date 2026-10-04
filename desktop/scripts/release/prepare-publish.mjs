// Downloads one signed build run and verifies it before anything is uploaded.
//   node scripts/release/prepare-publish.mjs <destination> <run id>
// Writes artifacts/verified.json for publish-desktop.mjs.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildWorkflow, desktopTargets, destinations, repository, requireDestinationSet, requireMain, validateManifest, validateRun,
} from './lib.mjs';

const [destination, runId] = process.argv.slice(2);
if (!Object.hasOwn(destinations, destination)) throw new Error('Unknown destination: ' + destination);
requireMain(process.env);
if (!/^[1-9]\d*$/.test(runId ?? '')) throw new Error('Provide a numeric source run ID.');
const gh = (args, capture = false) => execFileSync('gh', args, {
  encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});
const run = JSON.parse(gh(['api', 'repos/' + repository + '/actions/runs/' + runId], true));
validateRun(run, buildWorkflow, runId);
// Refuse an existing staging directory so retries cannot mix source runs.
mkdirSync('artifacts');
// One download per artifact: gh extracts a single --name straight into --dir,
// so each gets its own directory explicitly.
for (const t of desktopTargets.filter((t) => destinations[destination].platforms.includes(t.platform))) {
  const name = 'release-' + t.platform + '-' + t.arch;
  gh(['run', 'download', runId, '--repo', repository, '--name', name, '--dir', join('artifacts', name)]);
}
const manifests = [];
for (const directory of readdirSync('artifacts', { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const path = join('artifacts', directory.name);
  const found = readdirSync(path).filter((name) => /^manifest-[a-z]+-[a-z0-9]+\.json$/.test(name));
  if (found.length !== 1) throw new Error('Expected exactly one manifest in ' + path);
  const file = join(path, found[0]);
  gh(['attestation', 'verify', file, '--repo', repository, '--signer-workflow',
    repository + '/.github/workflows/' + buildWorkflow, '--source-ref', 'refs/heads/main',
    '--source-digest', run.head_sha, '--deny-self-hosted-runners']);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  validateManifest(manifest, run, path);
  manifests.push({ ...manifest, directory: resolve(path), manifest: resolve(file) });
}
requireDestinationSet(manifests, destination);
writeFileSync('artifacts/verified.json', JSON.stringify({ run, destination, manifests }, null, 2));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + manifests[0].version + '\ncommit=' + run.head_sha + '\n');
}
console.log('Verified ' + manifests.map((m) => m.platform + '-' + m.arch).join(', ') + ' ' + manifests[0].version + ' from run ' + runId);
