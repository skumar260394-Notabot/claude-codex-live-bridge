// Exercise upgrades through the actual MCP server, without either model or live inbox.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const sandbox = mkdtempSync(join(tmpdir(), 'bridge-setup-upgrade-'));
const project = join(sandbox, 'project with spaces');
const home = join(sandbox, 'isolated home');
mkdirSync(join(project, '.claude'), { recursive: true });
mkdirSync(home);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'];
const settingsPath = join(project, '.claude', 'settings.local.json');
const mcpPath = join(project, '.mcp.json');
const hookPath = fileURLToPath(new URL('./hook.mjs', import.meta.url));
const channelPath = fileURLToPath(new URL('./claude-channel.mjs', import.meta.url));
const oldHook = join(sandbox, 'removed cache', 'hook.mjs');
const oldChannel = join(sandbox, 'removed cache', 'claude-channel.mjs');
const unrelated = { type: 'command', command: 'unrelated-command', timeout: 23 };
const original = { permissions: { allow: ['Read(**)'] }, env: { PRESERVE: 'value' },
  hooks: Object.fromEntries(events.map(event => [event, [{ matcher: '*', custom: 'keep',
    hooks: [{ type: 'command', command: 'node', args: [oldHook, project, '--claude-live-bridge', '--extra'],
      timeout: 31, custom: 'keep handler' }, unrelated] }]])) };
const originalMcp = { custom: 'keep config', mcpServers: {
  other: { command: 'unrelated-server', args: ['keep'] },
  'claude-live-bridge': { command: 'node', args: [oldChannel, project],
    env: { PRESERVE: 'value' }, custom: 'keep server' }
}};
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
write(settingsPath, original);
write(mcpPath, originalMcp);
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'),
    CODEX_BRIDGE_ACTIVITY_HOME: join(home, '.codex-claude-live') },
  stdio: ['pipe', 'pipe', 'pipe']
});
const pending = new Map();
let counter = 0, stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
createInterface({ input: child.stdout }).on('line', line => {
  const msg = JSON.parse(line);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
async function call(name) {
  const id = ++counter;
  let timer;
  const response = new Promise((done, reject) => {
    timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timeout: ' + stderr)); }, 10000);
    pending.set(id, done);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
    params: { name, arguments: { project_path: project } } }) + '\n');
  try {
    const msg = await response;
    if (msg.error) throw new Error(msg.error.message);
    return JSON.parse(msg.result.content[0].text);
  } finally { clearTimeout(timer); }
}
try {
  const before = await call('bridge_status');
  assert.equal(before.setup.claude_hooks_configured, true);
  assert.equal(before.setup.claude_hooks_installed, false);
  assert.equal(before.setup.claude_channel_configured, true);
  assert.equal(before.setup.claude_channel_registered, false);
  assert.equal(before.setup.claude_paths.missing_hook_scripts.length, 7);
  assert.equal(before.setup.claude_paths.channel_script_exists, false);
  assert.match(before.setup.next_step, /refresh/);
  console.log('  ok  missing cache files are configured, not usable');

  const repaired = await call('connect_project');
  assert.equal(repaired.hooks_added, 0);
  assert.equal(repaired.hooks_updated, 7);
  assert.equal(repaired.claude_channel.changed, true);
  const expected = structuredClone(original);
  for (const event of events) expected.hooks[event][0].hooks[0].args[0] = hookPath;
  assert.deepEqual(read(settingsPath), expected);
  const expectedMcp = structuredClone(originalMcp);
  expectedMcp.mcpServers['claude-live-bridge'].args = [channelPath, project];
  assert.deepEqual(read(mcpPath), expectedMcp);
  const after = await call('bridge_status');
  assert.equal(after.setup.claude_hooks_installed, true);
  assert.equal(after.setup.claude_channel_registered, true);
  assert.equal(after.setup.claude_paths.refresh_needed, false);
  assert.equal(after.setup.complete, false, 'files do not prove a live session');
  console.log('  ok  reconnect repairs paths and preserves other hooks, servers, options and permissions');

  const savedSettings = readFileSync(settingsPath, 'utf8');
  const savedMcp = readFileSync(mcpPath, 'utf8');
  const again = await call('connect_project');
  assert.equal(again.hooks_updated, 0);
  assert.equal(again.hooks_added, 0);
  assert.equal(again.claude_channel.changed, false);
  assert.equal(readFileSync(settingsPath, 'utf8'), savedSettings);
  assert.equal(readFileSync(mcpPath, 'utf8'), savedMcp);
  console.log('  ok  repeated setup writes nothing');

  mkdirSync(join(sandbox, 'removed cache'), { recursive: true });
  writeFileSync(oldHook, '// old but still present');
  writeFileSync(oldChannel, '// old but still present');
  write(settingsPath, original);
  write(mcpPath, originalMcp);
  const existing = await call('bridge_status');
  assert.equal(existing.setup.claude_hooks_installed, true);
  assert.equal(existing.setup.claude_paths.refresh_needed, true);
  assert.equal((await call('connect_project')).hooks_updated, 7);
  assert.equal(read(mcpPath).mcpServers['claude-live-bridge'].args[0], channelPath);
  console.log('  ok  upgrades also refresh old paths before cache removal');

  const incomplete = read(settingsPath);
  delete incomplete.hooks.SessionEnd;
  write(settingsPath, incomplete);
  assert.equal((await call('bridge_status')).setup.claude_hooks_installed, false);
  assert.equal((await call('connect_project')).hooks_added, 1);
  console.log('  ok  incomplete lifecycle setup is identified and repaired');

  const wrongRoot = read(mcpPath);
  wrongRoot.mcpServers['claude-live-bridge'].args[1] = home;
  write(mcpPath, wrongRoot);
  assert.equal((await call('bridge_status')).setup.claude_channel_registered, false);
  assert.equal((await call('connect_claude_channel')).changed, true);
  assert.equal(read(mcpPath).mcpServers['claude-live-bridge'].args[1], project);

  const collision = { mcpServers: { 'claude-live-bridge': { command: 'some-other-server', args: ['foreign'] } } };
  write(mcpPath, collision);
  const refused = await call('connect_project');
  assert.equal(refused.connected, false);
  assert.match(refused.claude_channel.error, /refusing to overwrite/);
  assert.deepEqual(read(mcpPath), collision);
  console.log('  ok  wrong root repairs safely; foreign server collisions remain untouched');

  assert.equal(stderr, '');
  console.log('Setup upgrade regression suite passed (6 checks).');
} finally {
  child.stdin.end();
  child.kill();
  // Delete only the exact generated sandbox, after verifying its location.
  const target = resolve(sandbox);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes('bridge-setup-upgrade-'));
  rmSync(target, { recursive: true, force: true });
}
