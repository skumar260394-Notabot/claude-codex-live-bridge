import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), 'lovestory-tests-'));
const home = join(sandbox, 'home');
mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home,
  CODEX_HOME: join(home, '.codex'), CODEX_BRIDGE_ACTIVITY_HOME: join(home, '.codex-claude-live'),
  GIT_TERMINAL_PROMPT: '0' };
const scripts = [
  'plugins/lovestory/bridge/selftest.mjs',
  'plugins/lovestory/bridge/selftest-reciprocal.mjs',
  'tests/reply-notifications.mjs',
];
// Setting a temp home must prevent reads of personal Codex sessions or queues.
if (existsSync(env.CODEX_HOME)) throw new Error('Test home is not clean');
for (const script of scripts) {
  const run = spawnSync(process.execPath, [join(root, script)], {
    cwd: root, env, encoding: 'utf8', timeout: 120000,
  });
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  if (run.error || run.status !== 0) {
    process.stderr.write(`${script} failed: ${run.error?.message || run.status}\n`);
    process.exit(1);
  }
}
console.log('All isolated suites passed. Live app delivery requires a separate host test.');
