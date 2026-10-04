// Packages every channel of one build target, one electron-builder run each.
//   node scripts/release/package.mjs <platform> <signed|smoke>
// Run from desktop/ after client-bundle/ is staged. Outputs land in dist/<channel>/.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { desktopTargets } from './lib.mjs';

const [platform, mode] = process.argv.slice(2);
const target = desktopTargets.find((t) => t.platform === platform);
if (!target) throw new Error('Unknown platform: ' + platform);
if (!['signed', 'smoke'].includes(mode)) throw new Error('Choose signed or smoke mode.');
const cli = createRequire(import.meta.url).resolve('electron-builder/cli.js');

for (const channel of target.channels) {
  rmSync('dist/' + channel, { recursive: true, force: true });
  console.log('::group::' + platform + ' ' + channel + ' (' + mode + ')');
  execFileSync(process.execPath, [cli, '--config', 'electron-builder.config.cjs', '--' + target.flag, '--publish', 'never'], {
    stdio: 'inherit',
    env: { ...process.env, TIAO_DISTRIBUTION_CHANNEL: channel, TIAO_SIGNED: mode === 'signed' ? '1' : '0' },
  });
  console.log('::endgroup::');
}
