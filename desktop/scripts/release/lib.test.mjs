import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertPackagedChannel, desktopTargets, optionalCredentials, readAsarFile, releaseTag, repository, requireCredentials,
  requireDestinationSet, requireMain, selectTargets, sha256, steamBranch, steamBuildVdf, steamDepotIds, validateManifest,
  validateRun, version,
} from './lib.mjs';
import { writeAsar } from './fixtures.mjs';

const run = {
  id: 123, head_repository: { full_name: repository }, event: 'workflow_dispatch',
  head_branch: 'main', path: '.github/workflows/build-desktop.yml', conclusion: 'success', head_sha: 'a'.repeat(40),
};

test('release signing accepts only the canonical main dispatch, including no tag or fork trust', () => {
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: repository };
  assert.doesNotThrow(() => requireMain(env));
  for (const mutation of [
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/tags/desktop-v1.2.3' },
    { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'another/tiao' },
  ]) assert.throws(() => requireMain({ ...env, ...mutation }));
});

test('a green unrelated workflow, fork, PR, failed run or mismatched run cannot be published', () => {
  validateRun(run, 'build-desktop.yml', '123');
  for (const mutation of [
    { head_repository: { full_name: 'fork/tiao' } }, { event: 'pull_request' }, { event: 'push' },
    { head_branch: 'feature' }, { path: '.github/workflows/tests.yml' }, { conclusion: 'failure' }, { id: 456 },
  ]) assert.throws(() => validateRun({ ...run, ...mutation }, 'build-desktop.yml', '123'));
});

test('partial credential sets fail with names only; optional sets are all-or-none', () => {
  assert.throws(() => requireCredentials('macos', { MAC_CSC_LINK: 'sensitive-certificate' }), (error) =>
    error.message.includes('MAC_CSC_KEY_PASSWORD') && !error.message.includes('sensitive-certificate'));
  assert.throws(() => requireCredentials('mas', { MAS_CSC_LINK: 'x', MAS_CSC_KEY_PASSWORD: 'x' }), /MAS_PROVISIONING_PROFILE_BASE64/);
  assert.doesNotThrow(() => requireCredentials('linux', {}));
  assert.doesNotThrow(() => requireCredentials('windows', {}));
  assert.equal(optionalCredentials('msstore-submission', {}), false);
  assert.equal(optionalCredentials('msstore-submission', { MSSTORE_TENANT_ID: ' ' }), false);
  assert.throws(() => optionalCredentials('msstore-submission', { MSSTORE_TENANT_ID: 't' }), /MSSTORE_CLIENT_SECRET/);
  const full = Object.fromEntries(['MSSTORE_TENANT_ID', 'MSSTORE_CLIENT_ID', 'MSSTORE_CLIENT_SECRET', 'MSSTORE_SELLER_ID',
    'MSSTORE_PRODUCT_ID'].map((name) => [name, 'v']));
  assert.equal(optionalCredentials('msstore-submission', full), true);
});

test('versions are stable X.Y.Z and tags never move namespaces', () => {
  assert.equal(version('1.2.3'), '1.2.3');
  assert.equal(releaseTag('1.2.3'), 'desktop-v1.2.3');
  for (const invalid of ['1.2', '1.2.3-rc.1', 'v1.2.3', '01.2.3', '']) assert.throws(() => version(invalid));
});

test('platform selections map onto build legs', () => {
  assert.deepEqual(selectTargets('all').map((t) => t.platform), ['macos', 'windows', 'linux', 'mas', 'msstore']);
  assert.deepEqual(selectTargets('desktop').map((t) => t.platform), ['macos', 'windows', 'linux']);
  assert.deepEqual(selectTargets('stores').map((t) => t.platform), ['mas', 'msstore']);
  assert.throws(() => selectTargets('ios'));
  for (const target of desktopTargets) assert.ok(target.runner && target.flag && target.channels.length);
  assert.equal(desktopTargets.find((t) => t.platform === 'macos').arch, 'universal');
});

const manifestFor = (platform, channelFiles, versionValue = '1.2.3') => {
  const target = desktopTargets.find((t) => t.platform === platform);
  return { platform, arch: target.arch, version: versionValue, files: channelFiles.map(([name, channel]) => ({ name, channel })) };
};

test('each destination needs exactly its targets from one version', () => {
  const desktop = ['macos', 'windows', 'linux'].map((p) => manifestFor(p, [['a', 'direct'], ['b', 'itch'], ['c', 'steam']]));
  const mas = manifestFor('mas', [['p.pkg', 'mas']]);
  for (const destination of ['downloads-draft', 'itch', 'steam']) {
    assert.equal(requireDestinationSet(desktop, destination).length, 3);
    assert.throws(() => requireDestinationSet(desktop.slice(1), destination));
    assert.throws(() => requireDestinationSet([...desktop, desktop[0]], destination));
  }
  assert.throws(() => requireDestinationSet(desktop.map((m, i) => ({ ...m, version: i ? m.version : '1.2.4' })), 'steam'));
  assert.equal(requireDestinationSet([mas], 'mas').length, 1);
  assert.throws(() => requireDestinationSet(desktop, 'mas'));
  assert.throws(() => requireDestinationSet([manifestFor('msstore', [['x', 'msstore']])], 'mas'));
  assert.throws(() => requireDestinationSet(['macos', 'windows', 'linux'].map((p) => manifestFor(p, [['a', 'direct']])), 'itch'), /no itch files/);
});

test('artifact integrity rejects modified, unsigned, wrong-commit, wrong-channel and unsafe payloads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiao-release-test-'));
  try {
    const path = join(directory, 'game.exe');
    writeFileSync(path, 'signed binary stand-in');
    const manifest = {
      schema: 1, repository, commit: run.head_sha, runId: '123', mode: 'signed', version: '1.2.3',
      platform: 'windows', arch: 'x64', files: [{ name: 'game.exe', sha256: sha256(path), channel: 'direct' }],
    };
    validateManifest(manifest, run, directory);
    assert.throws(() => validateManifest({ ...manifest, mode: 'smoke' }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, commit: 'b'.repeat(40) }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, arch: 'arm64' }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, ...manifest.files] }, run, directory));
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], channel: 'mas' }] }, run, directory), /channel/);
    for (const name of ['../game.exe', '..\\game.exe', 'game.exe\ninjected', '-option.exe']) {
      assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], name }] }, run, directory));
    }
    symlinkSync(path, join(directory, 'link.exe'));
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], name: 'link.exe' }] }, run, directory));
    writeFileSync(path, 'tampered binary');
    assert.throws(() => validateManifest(manifest, run, directory), /checksum mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Steam settings refuse ambiguous depots and the default branch', () => {
  assert.deepEqual(steamDepotIds({ STEAM_DEPOT_WINDOWS: '5035581', STEAM_DEPOT_LINUX: '5035583', STEAM_DEPOT_MACOS: '5035582' }),
    { windows: '5035581', linux: '5035583', macos: '5035582' });
  assert.throws(() => steamDepotIds({ STEAM_DEPOT_WINDOWS: '1', STEAM_DEPOT_LINUX: '1', STEAM_DEPOT_MACOS: '2' }));
  assert.throws(() => steamDepotIds({ STEAM_DEPOT_WINDOWS: '1', STEAM_DEPOT_LINUX: '2' }));
  assert.equal(steamBranch(''), '');
  assert.equal(steamBranch('beta'), 'beta');
  assert.throws(() => steamBranch('default'));
  assert.throws(() => steamBranch('beta"; "SetLive" "default'));
  const vdf = steamBuildVdf({
    version: '1.2.3', commit: 'abc', outputDir: '/tmp/out', branch: '',
    roots: { windows: '/w', linux: '/l', macos: '/m' }, depots: { windows: '1', linux: '2', macos: '3' },
  });
  assert.match(vdf, /"AppID" "5035580"/);
  assert.doesNotMatch(vdf, /SetLive/);
  assert.match(vdf, /"FileExclusion" "steam_appid.txt"/);
  assert.match(steamBuildVdf({ version: '1.2.3', commit: 'abc', outputDir: '/o', branch: 'beta',
    roots: { windows: '/w', linux: '/l', macos: '/m' }, depots: { windows: '1', linux: '2', macos: '3' } }), /"SetLive" "beta"/);
});

test('packaged channel metadata is read from app.asar and enforced', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tiao-asar-test-'));
  try {
    const asar = (name, meta, unpacked = []) => {
      const path = join(directory, name);
      writeAsar(path, { 'main.cjs': '//', 'package.json': JSON.stringify(meta) }, unpacked);
      return path;
    };
    const direct = asar('direct.asar', { distributionChannel: 'direct' });
    assert.equal(JSON.parse(readAsarFile(direct, 'package.json')).distributionChannel, 'direct');
    assert.doesNotThrow(() => assertPackagedChannel(direct, 'direct'));
    assert.throws(() => assertPackagedChannel(direct, 'itch'), /expected itch/);
    const steam = asar('steam.asar', { distributionChannel: 'steam', steamBuild: true, steamAppId: 5035580 });
    assert.doesNotThrow(() => assertPackagedChannel(steam, 'steam'));
    assert.throws(() => assertPackagedChannel(asar('spacewar.asar', { distributionChannel: 'steam', steamBuild: true, steamAppId: 480 }), 'steam'), /appid/);
    assert.throws(() => assertPackagedChannel(asar('nosteam.asar', { distributionChannel: 'steam' }), 'steam'), /steamBuild/);
    assert.throws(() => assertPackagedChannel(asar('leak.asar', { distributionChannel: 'itch', steamBuild: true }), 'itch'), /steamBuild/);
    const mas = asar('mas.asar', { distributionChannel: 'mas' }, ['node_modules/steamworks.js/dist/steam_api.dylib']);
    assert.throws(() => assertPackagedChannel(mas, 'mas'), /steamworks/);
    assert.doesNotThrow(() => assertPackagedChannel(asar('clean-mas.asar', { distributionChannel: 'mas' }), 'mas'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
