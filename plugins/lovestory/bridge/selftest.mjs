import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const project = mkdtempSync(join(tmpdir(), 'claude-live-bridge-test-'));
const settingsDir = join(project, '.claude');
mkdirSync(settingsDir);
writeFileSync(join(settingsDir, 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read(**)'] } }));
const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'] });
const reader = createInterface({ input: server.stdout });
const waiting = new Map();
reader.on('line', line => { const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); waiting.delete(msg.id); });
let counter = 0;
async function call(name, args) {
  const id = ++counter;
  const reply = new Promise(resolve => waiting.set(id, resolve));
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  const msg = await reply;
  if (msg.error) throw new Error(msg.error.message);
  return JSON.parse(msg.result.content[0].text);
}
function hook(event, session, extra = {}) {
  const payload = { session_id: session, cwd: project, hook_event_name: event, ...extra };
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./hook.mjs', import.meta.url)), project], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim() ? JSON.parse(run.stdout.trim()) : null;
}

try {
  const connected = await call('connect_project', { project_path: project });
  assert.equal(connected.hooks_added, 7);
  assert.equal((await call('connect_project', { project_path: project })).hooks_added, 0);
  const settings = JSON.parse(readFileSync(join(settingsDir, 'settings.local.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['Read(**)']);
  hook('SessionStart', 'session-1');
  hook('PreToolUse', 'session-1', { tool_name: 'Read', tool_input: { file_path: join(project, 'src.js') } });
  assert.equal((await call('list_sessions', { project_path: project })).sessions[0].session_id, 'session-1');
  const hand = await call('raise_hand', { project_path: project, session_id: 'session-1', message: 'Can we discuss the API shape before committing?' });
  assert.equal((await call('hand_status', { project_path: project, session_id: 'session-1', hand_id: hand.id })).status, 'queued');
  const notice = hook('PostToolUse', 'session-1', { tool_name: 'Read', tool_input: { file_path: join(project, 'src.js') } });
  assert.match(notice.hookSpecificOutput.additionalContext, /discuss the API shape/);
  assert.equal(notice.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(notice.continue, undefined);
  assert.equal(notice.hookSpecificOutput.permissionDecision, undefined);
  assert.equal((await call('hand_status', { project_path: project, session_id: 'session-1', hand_id: hand.id })).status, 'injected_at_hook');
  assert.ok((await call('watch_activity', { project_path: project, session_id: 'session-1' })).events.length >= 4);
  assert.equal((await call('disconnect_project', { project_path: project })).hooks_removed, 7);
  assert.deepEqual(JSON.parse(readFileSync(join(settingsDir, 'settings.local.json'), 'utf8')).permissions.allow, ['Read(**)']);
  process.stdout.write('Claude Live Bridge self-test passed\n');
} finally {
  server.stdin.end();
  server.kill();
  rmSync(project, { recursive: true, force: true });
}
