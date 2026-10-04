// Decides the build matrix and checks credential presence (never values).
//   node scripts/release/plan.mjs desktop            (RELEASE_PLATFORM, RELEASE_MODE)
//   node scripts/release/plan.mjs credentials TARGET
import { appendFileSync, readFileSync } from 'node:fs';
import { requireCredentials, requireMain, selectTargets, version } from './lib.mjs';

const [command, target] = process.argv.slice(2);
const env = process.env;
const output = (key, value) => {
  console.log(key + '=' + value);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, key + '=' + value + '\n');
};
if (command === 'desktop') {
  const mode = env.GITHUB_EVENT_NAME === 'pull_request' ? 'smoke' : env.RELEASE_MODE;
  if (!['signed', 'smoke'].includes(mode)) throw new Error('Choose signed or smoke mode.');
  if (mode === 'signed') requireMain(env);
  output('mode', mode);
  output('matrix', JSON.stringify({ include: selectTargets(env.RELEASE_PLATFORM || 'all') }));
  output('version', version(JSON.parse(readFileSync('package.json', 'utf8')).version));
} else if (command === 'credentials') {
  requireCredentials(target, env);
  console.log('Required ' + target + ' configuration is present (values not printed).');
} else {
  throw new Error('Usage: plan.mjs desktop | credentials TARGET');
}
