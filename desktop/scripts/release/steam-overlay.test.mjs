import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { writeAsar } from './fixtures.mjs';

const script = fileURLToPath(new URL('./verify-app-macos.sh', import.meta.url));
const plist = readFileSync(new URL('../../build/entitlements.steam.plist', import.meta.url), 'utf8');

function verify({ steam = true, entitlements = plist, presenter = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tiao-overlay-gate-'));
  try {
    const app = join(root, 'Tiao Demo.app');
    const bin = join(root, 'bin');
    const contents = join(app, 'Contents');
    const native = join(contents, 'Resources/app.asar.unpacked/src');
    mkdirSync(native, { recursive: true });
    mkdirSync(join(contents, 'MacOS'));
    mkdirSync(bin);
    writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Tiao</string></dict></plist>`);
    writeFileSync(join(contents, 'MacOS/Tiao'), 'binary');
    writeAsar(join(contents, 'Resources/app.asar'), { 'package.json': JSON.stringify({ steamBuild: steam }) });
    if (presenter) writeFileSync(join(native, 'steamOverlayMac.node'), 'binary');
    const stub = (name, body) => writeFileSync(join(bin, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
    stub('codesign', 'case "$*" in *--entitlements*) printf "%s" "$TEST_ENTITLEMENTS" ;; *-dv*) printf "TeamIdentifier=4BHY8H2J25\\nflags=0x10000(runtime)\\n" ;; esac');
    stub('spctl', 'echo "source=Notarized Developer ID"');
    stub('xcrun', 'exit 0');
    stub('lipo', 'echo "x86_64 arm64"');
    return spawnSync('bash', [script, app], {
      encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_ENTITLEMENTS: entitlements },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('signed Steam artifact gate accepts the universal presenter and injection entitlements', { skip: process.platform !== 'darwin' }, () => {
  const result = verify();
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const key of ['allow-dyld-environment-variables', 'disable-library-validation']) {
  test(`signed Steam gate rejects a missing ${key} entitlement`, { skip: process.platform !== 'darwin' }, () => {
    const result = verify({ entitlements: plist.replace(new RegExp(`<key>com.apple.security.cs.${key}</key>\\s*<true/>`), '') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing Steam entitlement/);
  });
}
test('signed Steam gate rejects an absent native presenter', { skip: process.platform !== 'darwin' }, () => {
  const result = verify({ presenter: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing Steam Metal presenter/);
});
test('other channels do not require a Steam presenter or injection entitlement', { skip: process.platform !== 'darwin' }, () => {
  const result = verify({ steam: false, presenter: false, entitlements: '' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
