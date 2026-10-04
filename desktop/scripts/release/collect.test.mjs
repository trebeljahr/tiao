import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAsar } from './fixtures.mjs';

const script = fileURLToPath(new URL('./collect.mjs', import.meta.url));

function linuxFixture(meta = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'tiao-collect-'));
  writeFileSync(join(fixture, 'package.json'), '{"version":"1.2.3"}');
  for (const channel of ['direct', 'itch', 'steam']) {
    const resources = join(fixture, 'dist', channel, 'linux-unpacked', 'resources');
    mkdirSync(resources, { recursive: true });
    const baked = { distributionChannel: channel, ...(channel === 'steam' ? { steamBuild: true, steamAppId: 5035580 } : {}), ...meta[channel] };
    writeAsar(join(resources, 'app.asar'), { 'package.json': JSON.stringify(baked) });
    writeFileSync(join(fixture, 'dist', channel, 'linux-unpacked', 'tiao'), 'test executable');
    chmodSync(join(fixture, 'dist', channel, 'linux-unpacked', 'tiao'), 0o755);
  }
  writeFileSync(join(fixture, 'dist/direct/Tiao-1.2.3-linux-x86_64.AppImage'), 'direct image');
  writeFileSync(join(fixture, 'dist/direct/latest-linux.yml'), 'version: 1.2.3');
  writeFileSync(join(fixture, 'dist/itch/Tiao-1.2.3-linux-x86_64.AppImage'), 'itch image');
  return fixture;
}

const collect = (fixture) => execFileSync(process.execPath, [script, 'linux', 'x64', 'smoke'], {
  cwd: fixture, env: { ...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' }, stdio: 'pipe',
});

test('Linux collection tags every file with its channel, keeps executables and drops stale staging files', () => {
  const fixture = linuxFixture();
  try {
    collect(fixture);
    writeFileSync(join(fixture, 'dist/upload/stale-secret.txt'), 'must not be uploaded');
    collect(fixture);
    const output = join(fixture, 'dist/upload');
    assert.equal(readdirSync(output).includes('stale-secret.txt'), false);
    const manifest = JSON.parse(readFileSync(join(output, 'manifest-linux-x64.json'), 'utf8'));
    assert.equal(manifest.mode, 'smoke');
    assert.equal(manifest.signature, 'unsigned');
    assert.deepEqual(manifest.files.map((f) => [f.name, f.channel]), [
      ['Tiao-1.2.3-linux-x64-steam-depot.tar.gz', 'steam'],
      ['Tiao-1.2.3-linux-x86_64-itch.AppImage', 'itch'],
      ['Tiao-1.2.3-linux-x86_64.AppImage', 'direct'],
      ['latest-linux.yml', 'direct'],
    ]);
    const listing = execFileSync('tar', ['-tvzf', join(output, 'Tiao-1.2.3-linux-x64-steam-depot.tar.gz')], { encoding: 'utf8' });
    assert.match(listing, /-rwxr-xr-x.*tiao/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('collection refuses a build whose baked channel is wrong', () => {
  const fixture = linuxFixture({ itch: { distributionChannel: 'direct' } });
  try {
    assert.throws(() => collect(fixture), /baked as direct, expected itch/);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
