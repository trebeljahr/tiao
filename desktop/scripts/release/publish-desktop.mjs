// Uploads the files prepare-publish.mjs verified. Never rebuilds anything.
//   node scripts/release/publish-desktop.mjs <downloads-draft|itch|steam|mas|msstore>
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  oneFile, releaseTag, repository, requireCredentials, requireDestinationSet, steamBranch, steamBuildVdf, steamDepotIds,
} from './lib.mjs';

const [destination] = process.argv.slice(2);
const verified = JSON.parse(readFileSync('artifacts/verified.json', 'utf8'));
if (verified.destination !== destination) throw new Error('artifacts/verified.json was prepared for ' + verified.destination);
const { run } = verified;
const manifests = requireDestinationSet(verified.manifests, destination);
const appVersion = manifests[0].version;
const execute = (command, args, capture = false) => execFileSync(command, args, {
  encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});
const pathOf = (manifest, file) => join(manifest.directory, file.name);
const byPlatform = (platform) => manifests.find((m) => m.platform === platform);
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  console.log(key + '=' + value);
};

if (destination === 'downloads-draft') {
  const tag = releaseTag(appVersion);
  // The tag must already identify these exact tested bytes. Never retag or clobber a release.
  execute('git', ['fetch', '--no-tags', 'origin', 'refs/tags/' + tag]);
  const tagged = execute('git', ['rev-parse', 'FETCH_HEAD^{commit}'], true).trim();
  if (tagged !== run.head_sha) throw new Error('Tag ' + tag + ' does not point to the build commit.');
  const files = [];
  const checksums = [];
  for (const manifest of manifests) {
    files.push(manifest.manifest);
    for (const file of manifest.files.filter((f) => f.channel === 'direct')) {
      files.push(pathOf(manifest, file));
      checksums.push(file.sha256 + '  ' + file.name);
    }
  }
  const sumFile = 'artifacts/SHA256SUMS.txt';
  writeFileSync(sumFile, checksums.sort().join('\n') + '\n');
  const notes = 'artifacts/release-notes.txt';
  writeFileSync(notes, 'Tiao ' + appVersion + '\n\nBuild commit: ' + run.head_sha +
    '\nBuild run: https://github.com/' + repository + '/actions/runs/' + run.id +
    '\n\nThe macOS download is signed by Ricos Labs LLC and notarized by Apple. Windows downloads are signed by Ricos Labs LLC.' +
    '\nLinux files have signed GitHub build provenance. SHA256SUMS.txt lists download checksums.\n');
  execute('gh', ['release', 'create', tag, ...files, sumFile, '--repo', repository, '--verify-tag', '--draft',
    '--title', 'Tiao ' + appVersion, '--notes-file', notes]);
} else if (destination === 'itch') {
  requireCredentials('itch', process.env);
  const project = process.env.ITCH_USER + '/' + process.env.ITCH_GAME;
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(project)) throw new Error('Invalid itch project.');
  const butler = process.env.BUTLER_PATH || 'butler';
  const pushes = [
    ['macos', '.zip', 'osx-universal'],
    ['windows', '.zip', 'windows'],
    ['linux', '.AppImage', 'linux'],
  ];
  for (const [platform, suffix, itchChannel] of pushes) {
    const manifest = byPlatform(platform);
    execute(butler, ['push', pathOf(manifest, oneFile(manifest, 'itch', suffix)), project + ':' + itchChannel,
      '--userversion', appVersion]);
  }
} else if (destination === 'steam') {
  requireCredentials('steam', process.env);
  const depots = steamDepotIds(process.env);
  const branch = steamBranch(process.env.STEAM_BRANCH || '');
  const root = resolve('artifacts/steam');
  const roots = {};
  for (const platform of ['windows', 'linux', 'macos']) {
    const manifest = byPlatform(platform);
    const directory = join(root, platform);
    mkdirSync(directory, { recursive: true });
    // macOS tar may store extended attributes as AppleDouble ._* entries; GNU tar
    // on the Linux runner unpacks them as real files, which breaks the app's seal.
    execute('tar', ['-xzf', pathOf(manifest, oneFile(manifest, 'steam', '-depot.tar.gz')), '--exclude', '._*', '-C', directory]);
    const appleDouble = readdirSync(directory, { recursive: true }).find((name) => /(^|\/)\._/.test(String(name)));
    if (appleDouble) throw new Error('Depot still contains AppleDouble metadata: ' + appleDouble);
    roots[platform] = directory;
  }
  writeFileSync('artifacts/steam-build.vdf', steamBuildVdf({
    version: appVersion, commit: run.head_sha, outputDir: join(process.env.RUNNER_TEMP || resolve('artifacts'), 'steam-build-output'),
    roots, depots, branch,
  }));
  console.log('Steam build script ready for depots ' + Object.values(depots).join(', ') + (branch ? ' (set live on ' + branch + ')' : ' (upload only)'));
} else if (destination === 'mas') {
  const manifest = byPlatform('mas');
  output('package', pathOf(manifest, oneFile(manifest, 'mas', '.pkg')));
} else if (destination === 'msstore') {
  const manifest = byPlatform('msstore');
  output('package', pathOf(manifest, oneFile(manifest, 'msstore', '.appx')));
} else {
  throw new Error('Choose downloads-draft, itch, steam, mas or msstore.');
}
