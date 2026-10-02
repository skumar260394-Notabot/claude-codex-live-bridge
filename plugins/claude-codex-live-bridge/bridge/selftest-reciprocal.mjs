// Verification for the reciprocal half: the Claude channel server, the Codex
// hook MCP tool, and the two-way call protocol.
//
// Runs the real Claude channel server as a subprocess and speaks MCP to it, and
// runs the real Codex hook both through its MCP tool and as a subprocess with
// real hook payloads.
// `codex queue` is replaced by a recording stub via CODEX_BRIDGE_CLI, so the
// wake path is exercised end to end without touching a live Codex session.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const project = mkdtempSync(join(tmpdir(), 'claude-live-bridge-recip-'));
const home = mkdtempSync(join(tmpdir(), 'claude-live-bridge-home-'));
const results = [];
function ok(name) { results.push(name); process.stdout.write(`  ok  ${name}\n`); }

// ---------------------------------------------------------------- codex stub
// A fake `codex` that records its argv, so we can assert the exact command line
// the bridge builds and prove no shell is involved in passing the message.
const stubLog = join(home, 'codex-queue-calls.jsonl');
const stubJs = join(home, 'codex-stub.mjs');
writeFileSync(stubJs, [
  "import { appendFileSync } from 'node:fs';",
  `appendFileSync(${JSON.stringify(stubLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
  "process.stdout.write('queued\\n');"
].join('\n'));
function stubCalls() {
  try { return readFileSync(stubLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}

// The stub is a .mjs, which the bridge runs through this Node with no shell, so
// the wake path is exercised identically on Windows and POSIX.
const bridgeEnv = {
  ...process.env, HOME: home, USERPROFILE: home, CODEX_BRIDGE_CLI: stubJs,
  // Tight poll and staleness so the test observes a dead channel quickly.
  CLAUDE_BRIDGE_POLL_MS: '250', CLAUDE_BRIDGE_CHANNEL_STALE_MS: '2000'
};

// --------------------------------------------------------------- MCP client
function mcpClient(script, args, env) {
  const child = spawn(process.execPath, [here(script), ...args], { stdio: ['pipe', 'pipe', 'pipe'], env });
  const pending = new Map();
  const notifications = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method) notifications.push(msg);
  });
  let counter = 0;
  const request = (method, params) => {
    const id = ++counter;
    const reply = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return reply;
  };
  const call = async (name, argsObj = {}) => {
    const msg = await request('tools/call', { name, arguments: argsObj });
    if (msg.error) throw new Error(msg.error.message);
    return JSON.parse(msg.result.content[0].text);
  };
  return { child, request, call, notifications, stderr: () => stderr,
    stop: () => { child.stdin.end(); child.kill(); } };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(predicate, { timeout = 8000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate(); // predicates may be async
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

// ------------------------------------------------------------- codex hook run
function claudeHook(event, session, extra = {}) {
  const payload = { session_id: session, cwd: project, hook_event_name: event, ...extra };
  const run = spawnSync(process.execPath, [here('./hook.mjs'), project],
    { input: JSON.stringify(payload), encoding: 'utf8', env: bridgeEnv });
  assert.equal(run.status, 0, `claude hook exited ${run.status}: ${run.stderr}`);
  assert.equal(run.stderr.trim(), '', `claude hook wrote to stderr: ${run.stderr}`);
  return run.stdout.trim() ? JSON.parse(run.stdout.trim()) : null;
}

function codexHook(event, session, extra = {}) {
  const payload = { session_id: session, cwd: project, hook_event_name: event, transcript_path: null, ...extra };
  const run = spawnSync(process.execPath, [here('./codex-hook.mjs'), project],
    { input: JSON.stringify(payload), encoding: 'utf8', env: bridgeEnv });
  assert.equal(run.status, 0, `codex hook exited ${run.status}: ${run.stderr}`);
  assert.equal(run.stderr.trim(), '', `codex hook wrote to stderr: ${run.stderr}`);
  return run.stdout.trim() ? JSON.parse(run.stdout.trim()) : null;
}

let channel, codex;
const CODEX_THREAD = '11111111-2222-4333-8444-555555555555';

try {
  mkdirSync(join(project, '.claude'), { recursive: true });
  writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read(**)'] } }));

  codex = mcpClient('./server.mjs', [], bridgeEnv);
  channel = mcpClient('./claude-channel.mjs', [project], bridgeEnv);

  // --- 1. the channel declares itself a channel -----------------------------
  const init = await channel.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.deepEqual(init.result.capabilities.experimental['claude/channel'], {},
    'server must declare the claude/channel capability');
  assert.deepEqual(init.result.capabilities.tools, {}, 'two-way channel must declare tool capability');
  assert.equal(init.result.capabilities.experimental['claude/channel/permission'], undefined,
    'bridge must not opt in to permission relay');
  assert.match(init.result.instructions, /peer messages from another agent/);
  ok('channel declares claude/channel, tools, and no permission relay');

  const toolNames = (await channel.request('tools/list')).result.tools.map(t => t.name);
  assert.deepEqual(toolNames.sort(), ['ack_call', 'bridge_status', 'call_codex', 'call_status', 'calls',
    'close_call', 'codex_activity', 'codex_sessions', 'reply_to_codex'].sort());
  ok('channel exposes the reply and observation tools');

  // --- 2. Codex hooks make Codex observable --------------------------------
  const hooks = await codex.call('connect_codex_project', { project_path: project });
  assert.equal(hooks.hooks_added, 5);
  assert.equal((await codex.call('connect_codex_project', { project_path: project })).hooks_added, 0, 'must be idempotent');
  const written = JSON.parse(readFileSync(join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.equal(written.hooks.PreToolUse[0].hooks[0].type, 'mcp_tool');
  assert.equal(written.hooks.PreToolUse[0].hooks[0].tool, 'codex_hook_event');
  assert.equal(written.hooks.PreToolUse[0].hooks[0].input.project_path, project);
  const configuredOnly = await codex.call('bridge_status', { project_path: project });
  assert.equal(configuredOnly.setup.codex_hooks_installed, true);
  assert.equal(configuredOnly.setup.codex_hook_observed, false, 'a hook file does not prove Codex loaded it');
  assert.equal(configuredOnly.setup.complete, false);
  ok('connect_codex_project writes .codex/hooks.json idempotently');

  codexHook('SessionStart', CODEX_THREAD);
  await codex.call('codex_hook_event', { project_path: project, hook_event_name: 'PreToolUse',
    session_id: CODEX_THREAD, cwd: project, tool_name: 'shell', tool_input: { command: 'cargo test --all' }, turn_id: 't1' });
  codexHook('Stop', CODEX_THREAD, { last_assistant_message: 'Tests pass on the protocol crate.' });

  const seen = await channel.call('codex_sessions');
  assert.equal(seen.codex_sessions[0].session_id, CODEX_THREAD);
  assert.equal(seen.codex_sessions[0].endpoint, `thread:${CODEX_THREAD}`);
  assert.equal(seen.codex_sessions[0].last_message, 'Tests pass on the protocol crate.');
  const activity = await channel.call('codex_activity', {});
  assert.equal(activity.events.find(e => e.tool === 'shell').action, 'cargo test --all');
  ok('Claude observes Codex session activity, tools, and final message');

  // --- 3. Codex -> Claude, pushed to an idle session ------------------------
  const status = await codex.call('bridge_status', { project_path: project });
  assert.equal(status.live_channel, true, 'channel should be registered as live');
  assert.equal(status.setup.codex_hook_observed, true);
  assert.ok(status.setup.codex_hook_last_seen_at);
  ok('bridge_status sees the live Claude channel');

  const outbound = await codex.call('call_claude', {
    project_path: project, claude_endpoint: 'channel:main', subject: 'protocol shape',
    message: 'The turn budget should be per call, not per side. Agreed?', max_turns: 4
  });
  assert.equal(outbound.claude_path, 'channel');
  assert.equal(outbound.turn, 1);
  assert.equal(outbound.turns_remaining, 3);
  const pushed = await waitFor(
    () => channel.notifications.find(n => n.method === 'notifications/claude/channel'),
    { label: 'channel push notification' });
  assert.match(pushed.params.content, /turn budget should be per call/);
  assert.equal(pushed.params.meta.call_id, outbound.call_id);
  assert.equal(pushed.params.meta.from, 'codex');
  assert.equal(pushed.params.meta.turn, '1');
  assert.equal(pushed.params.meta.turns_remaining, '3');
  for (const key of Object.keys(pushed.params.meta)) {
    assert.match(key, /^[A-Za-z0-9_]+$/, `meta key "${key}" must be a plain identifier`);
    assert.equal(typeof pushed.params.meta[key], 'string', 'meta values must be strings');
  }
  ok('Codex -> Claude arrives as notifications/claude/channel with valid meta');

  const afterPush = await codex.call('call_status', { project_path: project, call_id: outbound.call_id });
  assert.equal(afterPush.turns[0].delivered_at !== null, true, 'delivery must be recorded, not lost to the race');
  assert.match(afterPush.turns[0].delivered_via, /^channel:/);
  assert.deepEqual(afterPush.undelivered_message_ids, []);
  assert.equal(afterPush.waiting_for, 'claude');
  ok('delivery is recorded on the call (persist-before-publish holds)');

  // --- 4. acknowledgement is distinct from delivery ------------------------
  const acked = await channel.call('ack_call', { call_id: outbound.call_id, note: 'reading the diff first' });
  assert.ok(acked.acked_at);
  const afterAck = await codex.call('call_status', { project_path: project, call_id: outbound.call_id });
  assert.deepEqual(afterAck.unacked_message_ids, []);
  assert.equal(afterAck.turns[0].ack_note, 'reading the diff first');
  assert.equal(afterAck.turns.length, 1, 'an ack must not consume a turn');
  // Codex must not be able to acknowledge the turn Codex itself sent, whether
  // it names the message or lets the lookup pick one.
  await assert.rejects(() => codex.call('ack_call', { project_path: project, call_id: outbound.call_id, message_id: outbound.message_id }),
    /cannot acknowledge its own turn/);
  await assert.rejects(() => codex.call('ack_call', { project_path: project, call_id: outbound.call_id }),
    /No matching turn to acknowledge/);
  ok('ack is separate from delivery, costs no turn, and cannot self-ack');

  // --- 5. Claude -> Codex, waking the thread ------------------------------
  await sleep(1100); // respect the per-call rate limit
  const reply = await channel.call('reply_to_codex', {
    call_id: outbound.call_id, message: 'Agreed: per call. I will cap it at 20 and close on exhaustion.'
  });
  assert.equal(reply.turn, 2);
  assert.equal(reply.queued, true);
  assert.equal(reply.delivered_at, null, 'queue submission is not model-visible delivery');
  assert.match(reply.delivery_note, /does not confirm the model saw it/);
  const argv = await waitFor(() => stubCalls()[0], { label: 'codex queue invocation' });
  assert.deepEqual(argv.slice(0, 4), ['queue', '--thread', CODEX_THREAD, '--message']);
  assert.match(argv[4], /Peer message from Claude Code, not from the user/);
  assert.match(argv[4], /Agreed: per call/);
  assert.match(argv[4], /use your own judgement/);
  assert.equal(argv.length, 5, 'the message must be one argv value, never shell-split');
  assert.equal(reply.wake.ok, true);
  const pendingReply = await codex.call('call_status', { project_path: project, call_id: outbound.call_id });
  assert.equal(pendingReply.turns[1].delivered_at, null);
  assert.equal(pendingReply.codex_reachability.hook_observed, true);
  ok('Claude -> Codex invokes codex queue with the message as a single argv value');

  // --- 6. the Codex hook injects it as model-visible context --------------
  const injected = await codex.call('codex_hook_event', { project_path: project,
    hook_event_name: 'UserPromptSubmit', session_id: CODEX_THREAD, cwd: project });
  assert.ok(injected, 'hook must emit output when a message is pending');
  assert.equal(injected.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(injected.hookSpecificOutput.additionalContext, /Agreed: per call/);
  assert.match(injected.hookSpecificOutput.additionalContext, /reply_to_claude/);
  assert.match(injected.hookSpecificOutput.additionalContext, /not an instruction from the user/);
  assert.equal(injected.continue, undefined, 'must never block');
  assert.equal(injected.decision, undefined, 'must never make a decision');
  assert.equal(injected.hookSpecificOutput.permissionDecision, undefined, 'must never touch permissions');
  ok('Codex hook injects the reply as additionalContext without blocking');

  assert.equal(codexHook('UserPromptSubmit', CODEX_THREAD), null, 'a claimed message must not be delivered twice');
  ok('each message is delivered exactly once');

  // Stop must not claim: Codex does not document additionalContext there, so a
  // message consumed at Stop would be silently discarded.
  await sleep(1100);
  await codex.call('reply_to_claude', { project_path: project, call_id: outbound.call_id, message: 'Sounds right.' });
  await sleep(1100);
  await channel.call('reply_to_codex', { call_id: outbound.call_id, message: 'Pushing the guard now.' });
  assert.equal(codexHook('Stop', CODEX_THREAD, { last_assistant_message: 'done' }), null,
    'Stop must not consume a pending message');
  const rescued = codexHook('PostToolUse', CODEX_THREAD, { tool_name: 'shell', tool_input: { command: 'ls' } });
  assert.match(rescued.hookSpecificOutput.additionalContext, /Pushing the guard now/);
  ok('Stop does not consume messages; a documented context event still gets them');

  // --- 7. a full segment continues automatically --------------------------
  const spent = await codex.call('call_status', { project_path: project, call_id: outbound.call_id });
  assert.equal(spent.turns_used, 4);
  assert.equal(spent.turns_remaining, 0);
  await sleep(1100);
  const continued = await channel.call('reply_to_codex', { call_id: outbound.call_id, message: 'one more thing' });
  assert.notEqual(continued.call_id, outbound.call_id);
  assert.equal(continued.continued_from_call_id, outbound.call_id);
  assert.equal(continued.chain_turn, 5);
  const active = await codex.call('call_status', { project_path: project, call_id: outbound.call_id });
  assert.equal(active.call_id, continued.call_id);
  assert.deepEqual(active.chain_call_ids, [outbound.call_id, continued.call_id]);
  assert.equal(active.chain_turns_used, 5);
  const closed = await codex.call('close_call', { project_path: project, call_id: outbound.call_id, reason: 'test finished' });
  assert.equal(closed.call_id, continued.call_id);
  await assert.rejects(() => codex.call('reply_to_claude', { project_path: project, call_id: outbound.call_id, message: 'hello?' }),
    /is closed/);
  ok('a full segment links to a continuation, and closing the original id closes the active segment');

  // --- 8. the other loop guards --------------------------------------------
  const rated = await codex.call('call_claude', { project_path: project, claude_endpoint: 'channel:main', subject: 'rate limit', message: 'first' });
  await assert.rejects(() => codex.call('reply_to_claude', { project_path: project, call_id: rated.call_id, message: 'instant second' }),
    /rate limited/);
  ok('consecutive turns on one call are rate limited');

  const opened = [rated.call_id];
  for (let i = opened.length; i < 8; i++) {
    opened.push((await codex.call('call_claude', { project_path: project, claude_endpoint: 'channel:main', subject: `fill ${i}`, message: `filler ${i}` })).call_id);
  }
  await assert.rejects(() => codex.call('call_claude', { project_path: project, claude_endpoint: 'channel:main', subject: 'one too many', message: 'nope' }),
    /calls are already open/);
  const closedOne = await channel.call('close_call', { call_id: opened[0], reason: 'done here' });
  assert.equal(closedOne.state, 'closed');
  assert.equal(closedOne.closed_by, 'claude');
  await codex.call('call_claude', { project_path: project, claude_endpoint: 'channel:main', subject: 'room again', message: 'after closing one' });
  ok('open calls are capped at 8 and closing one frees a slot');

  // Clear the filler calls so the remaining checks have slots to work in.
  for (const id of opened.slice(1)) await codex.call('close_call', { project_path: project, call_id: id, reason: 'self-test cleanup' });

  const capped = await codex.call('call_claude', { project_path: project, claude_endpoint: 'channel:main', subject: 'cap', message: 'x', max_turns: 9999 });
  assert.equal(capped.max_turns, 20);
  ok('max_turns is clamped to the hard limit of 20');

  // --- 9. honest reporting when nothing is listening ----------------------
  channel.stop();
  await waitFor(async () => !(await codex.call('bridge_status', { project_path: project })).live_channel,
    { label: 'channel to be seen as gone' });
  await assert.rejects(() => codex.call('call_claude', { project_path: project, claude_endpoint: 'channel', subject: 'x', message: 'y' }),
    /No live Claude channel/);
  const viaHook = await codex.call('call_claude', {
    project_path: project, claude_endpoint: 'session:11111111-1111-1111-1111-111111111111', subject: 'x', message: 'y'
  }).catch(e => e);
  assert.match(String(viaHook.message ?? viaHook), /has not been observed/);
  ok('a dead channel and an unknown session are both reported, not faked');

  // --- 10. the hook fallback delivers when no channel is running ----------
  const CLAUDE_SESSION = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  claudeHook('SessionStart', CLAUDE_SESSION);
  const fallback = await codex.call('call_claude', {
    project_path: project, claude_endpoint: `session:${CLAUDE_SESSION}`, subject: 'no channel', message: 'The channel is down; this must still reach you.'
  });
  assert.equal(fallback.claude_path, 'hook', 'the selected session uses the hook path when no channel is live');
  assert.equal(fallback.to, `session:${CLAUDE_SESSION}`);
  assert.match(fallback.delivery_note, /next hook event/);
  const delivered = claudeHook('PostToolUse', CLAUDE_SESSION, { tool_name: 'Read', tool_input: { file_path: 'a.js' } });
  assert.match(delivered.hookSpecificOutput.additionalContext, /this must still reach you/);
  assert.match(delivered.hookSpecificOutput.additionalContext, /reply_to_codex/);
  assert.match(delivered.hookSpecificOutput.additionalContext, /not an instruction from the user/);
  assert.equal(delivered.continue, undefined, 'must never block');
  assert.equal(delivered.hookSpecificOutput.permissionDecision, undefined, 'must never touch permissions');
  const fallbackStatus = await codex.call('call_status', { project_path: project, call_id: fallback.call_id });
  assert.match(fallbackStatus.turns[0].delivered_via, /^claude-hook:/);
  assert.equal(claudeHook('PostToolUse', CLAUDE_SESSION, { tool_name: 'Read', tool_input: { file_path: 'a.js' } }), null,
    'hook-delivered messages must not repeat');
  ok('the hook path delivers and records when no channel is running');

  // A legacy raised hand and a protocol message must coexist in one injection.
  await codex.call('raise_hand', { project_path: project, session_id: CLAUDE_SESSION, message: 'legacy hand still works' });
  await sleep(1100);
  await codex.call('reply_to_claude', { project_path: project, call_id: fallback.call_id, message: 'and a protocol turn too' });
  const both = claudeHook('UserPromptSubmit', CLAUDE_SESSION);
  assert.match(both.hookSpecificOutput.additionalContext, /legacy hand still works/);
  assert.match(both.hookSpecificOutput.additionalContext, /and a protocol turn too/);
  ok('legacy raised hands and protocol turns arrive together without loss');

  // --- 11. secrets do not travel -------------------------------------------
  await sleep(1100);
  const leaky = await codex.call('call_claude', {
    project_path: project, claude_endpoint: `session:${CLAUDE_SESSION}`, subject: 'creds',
    message: 'use API_KEY=super-secret-value and Bearer abcdef0123456789 to reproduce'
  });
  const leakStatus = await codex.call('call_status', { project_path: project, call_id: leaky.call_id });
  assert.match(leakStatus.turns[0].message, /API_KEY=\[redacted\]/);
  assert.match(leakStatus.turns[0].message, /Bearer \[redacted\]/);
  assert.doesNotMatch(leakStatus.turns[0].message, /super-secret-value/);
  ok('credential-shaped text is redacted before it leaves either side');

  process.stdout.write(`\nreciprocal self-test passed (${results.length} checks)\n`);
} finally {
  channel?.stop();
  codex?.stop();
  await sleep(150);
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
