import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { desktopActivityReadTools, listDesktopActivity, watchDesktopActivity } from './desktop-activity.mjs';
import { protectLocalConfigs } from './local-config.mjs';
import { appendEvent, atomicJson, handDir, hookPath, listHandFiles, projectDir, projectRoot, readJson, safeSessionId, sanitizeSummary, sessionFile } from './common.mjs';
import {
  DEFAULT_MAX_TURNS, MAX_OPEN_CALLS, MAX_TURNS_LIMIT, PROTOCOL_VERSION, bridgeConfigPath, maxConversationTurns,
  ackTurn, callStatus, closeCall, codexHookObservation, listCalls, listChannels, openCall, parseEndpoint, readCall,
  readJsonl, resolveClaudeEndpoint, resolveCodexCli, resolveCodexEndpoint, sendTurn, takeInbox,
  codexSessionFile
} from './protocol.mjs';

const codexHookPath = fileURLToPath(new URL('./codex-hook.mjs', import.meta.url));

const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd'];
const sleep = ms => new Promise(done => setTimeout(done, ms));

function settingsPath(root) { return join(root, '.claude', 'settings.local.json'); }
function bridgeHandler(root) { return { type: 'command', command: 'node', args: [hookPath, root, '--claude-live-bridge'], timeout: 10 }; }
function isOurs(handler, root) {
  return handler?.type === 'command' && handler.command === 'node' &&
    Array.isArray(handler.args) && handler.args[1] === root && handler.args[2] === '--claude-live-bridge';
}
// Ownership and usability are separate: an old owned entry may target a deleted cache.
function scriptExists(path, root) {
  if (typeof path !== 'string' || !path.trim()) return false;
  try { return statSync(resolve(root, path)).isFile(); }
  catch { return false; }
}
function claudeSetup(root) {
  const hooks = readJson(settingsPath(root), null)?.hooks ?? {};
  const owned = events.flatMap(event => (Array.isArray(hooks[event]) ? hooks[event] : [])
    .flatMap(group => Array.isArray(group?.hooks) ? group.hooks : [])
    .filter(handler => isOurs(handler, root)).map(handler => ({ event, handler })));
  const missingEvents = events.filter(event => !owned.some(item =>
    item.event === event && scriptExists(item.handler.args[0], root)));
  const entry = readJson(mcpConfigPath(root), null)?.mcpServers?.[CHANNEL_SERVER_NAME];
  const channelConfigured = isOurChannelEntry(entry);
  const channelUsable = channelConfigured && entry.command === 'node' &&
    entry.args?.[1] === root && scriptExists(entry.args[0], root);
  return {
    hooks_configured: owned.length > 0,
    hooks_usable: missingEvents.length === 0,
    missing_hook_events: missingEvents,
    missing_hook_scripts: owned.filter(item => !scriptExists(item.handler.args[0], root))
      .map(item => ({ event: item.event, path: item.handler.args[0] ?? null })),
    channel_configured: channelConfigured,
    channel_usable: !!channelUsable,
    channel_script: channelConfigured ? entry.args?.[0] ?? null : null,
    channel_script_exists: channelConfigured && scriptExists(entry.args?.[0], root),
    refresh_needed: owned.some(item => item.handler.args[0] !== hookPath) ||
      (channelConfigured && (entry.args?.[0] !== channelScript || entry.args?.[1] !== root ||
        entry.command !== 'node'))
  };
}
function writeSettings(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, path);
}

function connectProject(args) {
  const root = projectRoot(args.project_path);
  const path = settingsPath(root);
  const localConfig = protectLocalConfigs(root, [path, mcpConfigPath(root)]);
  const settings = readJson(path, {});
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Claude local settings must be a JSON object');
  if (settings.hooks == null) settings.hooks = {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('Claude hooks setting must be an object');
  let added = 0;
  let updated = 0;
  for (const event of events) {
    if (settings.hooks[event] == null) settings.hooks[event] = [];
    if (!Array.isArray(settings.hooks[event])) throw new Error(`Claude hook setting ${event} must be an array`);
    // Refresh only our script argument; preserve grouping, options and other hooks.
    settings.hooks[event] = settings.hooks[event].map(group => {
      if (!Array.isArray(group?.hooks)) return group;
      return { ...group, hooks: group.hooks.map(handler => {
        if (!isOurs(handler, root) || handler.args[0] === hookPath) return handler;
        updated++;
        return { ...handler, args: [hookPath, ...handler.args.slice(1)] };
      }) };
    });
    const present = settings.hooks[event].some(group => Array.isArray(group?.hooks) && group.hooks.some(h => isOurs(h, root)));
    if (!present) { settings.hooks[event].push({ hooks: [bridgeHandler(root)] }); added++; }
  }
  if (added || updated) writeSettings(path, settings);
  mkdirSync(join(projectDir(root), 'sessions'), { recursive: true });
  // Also register the reciprocal channel, so one call connects both directions.
  let channel;
  try { channel = connectClaudeChannel(root); }
  catch (error) { channel = { error: error.message }; }
  return { project_path: root, settings_path: path, hooks_added: added, hooks_updated: updated, connected: !channel?.error,
    claude_channel: channel, local_config: localConfig,
    note: 'Visibility begins when Claude Code loads these hooks and emits its next event. An idle session has no event to receive a raised hand until it resumes.',
    channel_note: channel?.error
      ? `Could not register the channel in .mcp.json: ${channel.error}`
      : `For two-way calling, start Claude Code with: ${launchCommand()} — then approve the development-channel warning and the new MCP server once. Until then only the hook path works, which cannot reach an idle session.` };
}

function disconnectProject(args) {
  const root = projectRoot(args.project_path);
  const path = settingsPath(root);
  const settings = readJson(path, null);
  if (!settings?.hooks) {
    // No hooks to strip, but a channel entry may still be registered.
    return { project_path: root, hooks_removed: 0, claude_channel: disconnectClaudeChannel(root) };
  }
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
      const handlers = group.hooks.filter(h => { if (isOurs(h, root)) { removed++; return false; } return true; });
      if (handlers.length) kept.push({ ...group, hooks: handlers });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (removed) writeSettings(path, settings);
  const channel = disconnectClaudeChannel(root);
  return { project_path: root, hooks_removed: removed, claude_channel: channel,
    note: 'Saved local activity remains under ~/.codex-claude-live.' };
}

function readEvents(root, id) {
  const path = sessionFile(root, id);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function claudeSessionLabels() {
  const labels = new Map();
  const history = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'history.jsonl');
  try {
    for (const line of readFileSync(history, 'utf8').split('\n')) {
      try {
        const entry = JSON.parse(line);
        const display = String(entry.display ?? '').trim();
        if (entry.sessionId && display && !display.startsWith('/') && !labels.has(entry.sessionId)) {
          labels.set(entry.sessionId, sanitizeSummary(display, 100));
        }
      } catch { /* Ignore an incomplete history line. */ }
    }
  } catch { /* Session IDs remain usable when Claude history is unavailable. */ }
  return labels;
}

function listSessions(args) {
  const root = projectRoot(args.project_path);
  const dir = join(projectDir(root), 'sessions');
  if (!existsSync(dir)) return { project_path: root, sessions: [] };
  const labels = claudeSessionLabels();
  const sessions = readdirSync(dir).filter(name => name.endsWith('.jsonl')).map(name => {
    const session_id = name.slice(0, -6);
    const log = readEvents(root, session_id);
    const last = log.at(-1) ?? null;
    const stopped = [...log].reverse().find(e => e.event === 'Stop' || e.event === 'SessionEnd');
    return { session_id, name: labels.get(session_id) ?? null, name_source: labels.has(session_id) ? 'first_prompt' : null,
      endpoint: `session:${session_id}`, delivery: 'next_hook_event',
      last_event_at: last?.at ?? null, last_event: last?.event ?? null,
      last_action: last?.action ?? null, last_message: stopped?.message ?? null, event_count: log.length };
  }).sort((a, b) => (b.last_event_at ?? '').localeCompare(a.last_event_at ?? '')).slice(0, 30);
  return { project_path: root, sessions,
    live_channels: listChannels(root).filter(c => c.live).map(c => ({ endpoint: c.endpoint, session_id_hint: c.claude_session_id_hint ?? null })),
    note: 'Choose an existing session endpoint for a named session. Session delivery waits for its next hook event. A live channel can reach an idle Claude Code session, but its channel ID is not reliably tied to a Claude session name.' };
}

async function watchActivity(args) {
  const root = projectRoot(args.project_path);
  const id = safeSessionId(args.session_id);
  const cursor = Math.max(0, Math.floor(Number(args.after_cursor ?? 0) || 0));
  const waitMs = Math.max(0, Math.min(20000, Math.floor(Number(args.wait_ms ?? 0) || 0)));
  const deadline = Date.now() + waitMs;
  let log = readEvents(root, id);
  while (log.length <= cursor && Date.now() < deadline) {
    await sleep(Math.min(300, deadline - Date.now()));
    log = readEvents(root, id);
  }
  const batch = log.slice(cursor, cursor + 50);
  return { session_id: id, events: batch, next_cursor: cursor + batch.length, more: log.length > cursor + batch.length };
}

function raiseHand(args) {
  const root = projectRoot(args.project_path);
  const id = safeSessionId(args.session_id);
  if (!existsSync(sessionFile(root, id))) throw new Error('Session is not visible yet; select a session returned by list_sessions');
  const message = String(args.message ?? '').trim();
  if (!message || message.length > 2000) throw new Error('message must contain 1 to 2000 characters');
  const hand = { id: randomUUID(), session_id: id, message, queued_at: new Date().toISOString() };
  atomicJson(join(handDir(root, id, 'pending'), `${hand.queued_at.replace(/[:.]/g, '-')}-${hand.id}.json`), hand);
  appendEvent(root, id, { event: 'RaisedHandQueued', hand_id: hand.id, message });
  return { ...hand, status: 'queued', note: 'Non-blocking. Claude receives this at its next supported hook event; the current tool call is not interrupted.' };
}

function handStatus(args) {
  const root = projectRoot(args.project_path);
  const id = safeSessionId(args.session_id);
  const handId = String(args.hand_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(handId)) throw new Error('Invalid hand_id');
  for (const status of ['pending', 'delivered']) {
    for (const file of listHandFiles(root, id, status)) {
      if (file.endsWith(`${handId}.json`)) return { status: status === 'pending' ? 'queued' : 'injected_at_hook', ...readJson(file) };
    }
  }
  return { status: 'not_found', hand_id: handId };
}

function git(path, args) {
  try { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function gitInfo(path) {
  const root = git(path, ['rev-parse', '--show-toplevel']);
  if (!root) return { path, git_repository: false };
  const common = git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const modified = git(path, ['diff', '--name-only', '-z', 'HEAD']);
  const untracked = git(path, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = [...new Set([...(modified ?? '').split('\0'), ...(untracked ?? '').split('\0')].filter(Boolean))].sort();
  return { path, git_repository: true, root, common_git_dir: common,
    branch: git(path, ['branch', '--show-current']) || '(detached)',
    head: git(path, ['rev-parse', '--short=12', 'HEAD']), changed_files: files.slice(0, 200), changed_file_count: files.length };
}
function gitOverlap(args) {
  const codex = gitInfo(projectRoot(args.codex_path));
  const claude = gitInfo(projectRoot(args.claude_path));
  const sameWorktree = codex.git_repository && claude.git_repository && resolve(codex.root).toLowerCase() === resolve(claude.root).toLowerCase();
  const sameRepository = codex.git_repository && claude.git_repository && codex.common_git_dir && claude.common_git_dir &&
    resolve(codex.common_git_dir).toLowerCase() === resolve(claude.common_git_dir).toLowerCase();
  const changedOverlap = codex.changed_files?.filter(file => claude.changed_files?.includes(file)) ?? [];
  return { codex, claude, same_worktree: !!sameWorktree, same_repository: !!sameRepository,
    overlapping_changed_files: changedOverlap,
    note: sameWorktree ? 'Both agents share one checkout; Git cannot attribute current uncommitted edits to either agent.' :
      sameRepository ? 'Separate worktrees in one repository; review changed paths and commits before integration.' :
      'These paths do not resolve to the same local Git repository. A matching remote alone does not create a live Claude message channel.' };
}

/* ===================================================================== */
/* Reciprocal half: the two-way call protocol with a Claude Code session. */
/* ===================================================================== */

const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

function codexHooksPath(root) { return join(root, '.codex', 'hooks.json'); }
function codexHookInput(event, root = null) {
  const input = { hook_event_name: event, session_id: '${session_id}', cwd: '${cwd}' };
  if (root) input.project_path = root;
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    Object.assign(input, { turn_id: '${turn_id}', tool_name: '${tool_name}', tool_input: '${tool_input}', tool_use_id: '${tool_use_id}' });
  }
  if (event === 'Stop') input.last_assistant_message = '${last_assistant_message}';
  return input;
}
function codexMcpHook(event, root) {
  return { type: 'mcp_tool', server: 'claude-live-bridge', tool: 'codex_hook_event',
    input: codexHookInput(event, root), timeout: 15, statusMessage: 'claude-codex-live-bridge' };
}
function isOurCodexHook(handler, root) {
  return handler?.type === 'mcp_tool' && handler.server === 'claude-live-bridge' &&
    handler.tool === 'codex_hook_event' && handler.input?.project_path === root;
}
function isOurLegacyCodexHook(handler, root) {
  return handler?.type === 'command' && typeof handler.command === 'string' &&
    handler.command.includes('codex-hook.mjs') && handler.command.includes(root);
}

/**
 * Install the Codex-side hooks so a Claude session can observe this Codex
 * session and so Claude's messages get injected as additionalContext.
 * The MCP tool hook avoids Windows shell quoting and passes the project root
 * as structured data, including roots with spaces.
 */
function connectCodexProject(args) {
  const root = projectRoot(args.project_path);
  const path = codexHooksPath(root);
  const localConfig = protectLocalConfigs(root, [path]);
  const config = readJson(path, {});
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Codex hooks config must be a JSON object');
  if (config.hooks == null) config.hooks = {};
  if (typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('Codex hooks setting must be an object');
  let added = 0;
  let replaced = 0;
  for (const event of CODEX_HOOK_EVENTS) {
    if (config.hooks[event] == null) config.hooks[event] = [];
    if (!Array.isArray(config.hooks[event])) throw new Error(`Codex hook setting ${event} must be an array`);
    config.hooks[event] = config.hooks[event].flatMap(group => {
      if (!Array.isArray(group?.hooks)) return [group];
      const hooks = group.hooks.filter(h => {
        if (isOurLegacyCodexHook(h, root)) { replaced++; return false; }
        return true;
      });
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    const present = config.hooks[event].some(group => Array.isArray(group?.hooks) && group.hooks.some(h => isOurCodexHook(h, root)));
    if (!present) { config.hooks[event].push({ hooks: [codexMcpHook(event, root)] }); added++; }
  }
  // SessionEnd cannot call an MCP tool. Remove this bridge's old command hook
  // while keeping other handlers and event groups intact.
  if (Array.isArray(config.hooks.SessionEnd)) {
    config.hooks.SessionEnd = config.hooks.SessionEnd.flatMap(group => {
      if (!Array.isArray(group?.hooks)) return [group];
      const hooks = group.hooks.filter(h => {
        if (isOurLegacyCodexHook(h, root)) { replaced++; return false; }
        return true;
      });
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    if (!config.hooks.SessionEnd.length) delete config.hooks.SessionEnd;
  }
  if (added || replaced) writeSettings(path, config);
  mkdirSync(join(projectDir(root), 'codex-sessions'), { recursive: true });
  return {
    project_path: root, hooks_path: path, hooks_added: added, hooks_replaced: replaced, connected: true, local_config: localConfig,
    note: 'Codex hooks require trust before they run. Review them with /hooks in Codex, then restart the session so they load. Until then Claude cannot observe this Codex session.'
  };
}

function disconnectCodexProject(args) {
  const root = projectRoot(args.project_path);
  const path = codexHooksPath(root);
  const config = readJson(path, null);
  if (!config?.hooks) return { project_path: root, hooks_removed: 0 };
  let removed = 0;
  for (const event of Object.keys(config.hooks)) {
    const groups = config.hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) { kept.push(group); continue; }
      const handlers = group.hooks.filter(h => { if (isOurCodexHook(h, root) || isOurLegacyCodexHook(h, root)) { removed++; return false; } return true; });
      if (handlers.length) kept.push({ ...group, hooks: handlers });
    }
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
  if (removed) writeSettings(path, config);
  return { project_path: root, hooks_removed: removed };
}

// Codex's MCP hook runner reads the JSON text returned by this tool as hook
// output. Reuse the same hook implementation as the command path, while
// avoiding shell parsing of Windows paths and model-authored content.
function codexHookEvent(args) {
  let root = projectRoot(args.project_path || args.cwd);
  if (!args.project_path) {
    // Plugin-bundled hooks get the session cwd. If Codex starts in a project
    // subdirectory, find the channel config so both agents use one store key.
    for (let dir = root; ; dir = dirname(dir)) {
      let config = null;
      try { config = readJson(join(dir, '.mcp.json'), null); } catch { /* ignore an unrelated invalid file */ }
      if (isOurChannelEntry(config?.mcpServers?.[CHANNEL_SERVER_NAME])) { root = dir; break; }
      if (dirname(dir) === dir) break;
    }
  }
  const run = spawnSync(process.execPath, [codexHookPath, root], {
    input: JSON.stringify(args), encoding: 'utf8', timeout: 12000,
    shell: false, windowsHide: true
  });
  if (run.error || run.status !== 0 || run.stderr?.trim()) {
    throw new Error(`Codex bridge hook failed: ${sanitizeSummary(run.error?.message || run.stderr || `exit ${run.status}`, 300)}`);
  }
  return run.stdout?.trim() ? JSON.parse(run.stdout) : {};
}

const CHANNEL_SERVER_NAME = 'claude-live-bridge';
const channelScript = fileURLToPath(new URL('./claude-channel.mjs', import.meta.url));

function mcpConfigPath(root) { return join(root, '.mcp.json'); }

/**
 * Register the bridge channel in <project>/.mcp.json so Claude Code can spawn
 * it, preserving any servers already configured there. Claude Code still needs
 * the one-time --dangerously-load-development-channels flag and its consent
 * prompt; nothing here can grant those.
 */
function connectClaudeChannel(root) {
  const path = mcpConfigPath(root);
  const config = readJson(path, {});
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('.mcp.json must be a JSON object');
  if (config.mcpServers == null) config.mcpServers = {};
  if (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) throw new Error('.mcp.json mcpServers must be an object');
  const existing = config.mcpServers[CHANNEL_SERVER_NAME];
  if (existing && !isOurChannelEntry(existing)) {
    throw new Error(`.mcp.json already defines an MCP server named "${CHANNEL_SERVER_NAME}" that does not point at this bridge. Rename or remove it first; refusing to overwrite someone else's server.`);
  }
  const localConfig = protectLocalConfigs(root, [path]);
  const desired = { command: 'node', args: [channelScript, root] };
  if (existing && existing.command === desired.command &&
      existing.args?.[0] === channelScript && existing.args?.[1] === root) {
    return { mcp_config_path: path, channel_server: CHANNEL_SERVER_NAME, changed: false, local_config: localConfig, launch_command: launchCommand() };
  }
  // Ours but stale (moved plugin or different project root): update in place and
  // keep any env or extra keys the user added.
  config.mcpServers[CHANNEL_SERVER_NAME] = { ...(existing ?? {}), ...desired };
  writeSettings(path, config);
  return { mcp_config_path: path, channel_server: CHANNEL_SERVER_NAME, changed: true, updated_existing: !!existing, local_config: localConfig, launch_command: launchCommand() };
}

// Ours only if it actually launches this bridge's channel script.
function isOurChannelEntry(entry) {
  return Array.isArray(entry?.args) && entry.args.some(arg => typeof arg === 'string' && arg.includes('claude-channel.mjs'));
}

function launchCommand() {
  return `claude --dangerously-load-development-channels server:${CHANNEL_SERVER_NAME}`;
}

function disconnectClaudeChannel(root) {
  const path = mcpConfigPath(root);
  const config = readJson(path, null);
  const entry = config?.mcpServers?.[CHANNEL_SERVER_NAME];
  if (!entry) return { mcp_config_path: path, removed: false };
  if (!isOurChannelEntry(entry)) {
    return { mcp_config_path: path, removed: false, kept: `"${CHANNEL_SERVER_NAME}" in .mcp.json does not point at this bridge, so it was left alone.` };
  }
  delete config.mcpServers[CHANNEL_SERVER_NAME];
  writeSettings(path, config);
  return { mcp_config_path: path, removed: true };
}

function bridgeStatus(args) {
  const root = projectRoot(args.project_path);
  const channels = listChannels(root);
  const cli = resolveCodexCli();
  const codexHook = codexHookObservation(root);
  const claude = claudeSetup(root);
  const registered = claude.channel_usable;
  const liveChannel = channels.some(c => c.live);
  const codexHooksInstalled = Object.values(readJson(codexHooksPath(root), null)?.hooks ?? {})
    .some(groups => Array.isArray(groups) && groups.some(g => Array.isArray(g?.hooks) && g.hooks.some(h => isOurCodexHook(h, root))));
  const claudeHooksInstalled = claude.hooks_usable;
  return {
    protocol: PROTOCOL_VERSION, project_path: root, store: projectDir(root),
    desktop_activity: listDesktopActivity({ project_path: root }),
    setup: {
      claude_hooks_configured: claude.hooks_configured,
      claude_hooks_installed: claudeHooksInstalled,
      claude_channel_configured: claude.channel_configured,
      claude_paths: claude,
      claude_channel_registered: registered,
      claude_channel_running: liveChannel,
      codex_hooks_installed: codexHooksInstalled,
      codex_hook_observed: codexHook.observed,
      codex_hook_last_seen_at: codexHook.last_event_at,
      complete: claudeHooksInstalled && registered && liveChannel && codexHook.observed,
      next_step: !claudeHooksInstalled || !registered || claude.refresh_needed
        ? 'Run connect_project to install or refresh Claude hook and channel paths; then reload the Claude Code session as required.'
        : !liveChannel ? `Channel registered but not running. Start Claude Code with: ${launchCommand()}`
        : !codexHooksInstalled && !codexHook.observed ? 'Run connect_codex_project, then trust the hooks with /hooks in Codex and restart the session.'
        : !codexHook.observed ? 'Codex hook config exists, but no hook event has been observed. Trust it with /hooks, restart Codex, and let this project emit an event.'
        : null
    },
    claude_channels: channels,
    live_channel: liveChannel,
    claude_hook_sessions: listSessions(args).sessions.map(s => ({ endpoint: `session:${s.session_id}`, last_event_at: s.last_event_at })),
    codex_queue: cli.ok ? { available: true, cli: cli.path } : { available: false, reason: cli.reason },
    delivery: {
      codex_to_claude_channel: channels.some(c => c.live)
        ? 'Live. Messages push into the open Claude session even while it is idle.'
        : 'No live channel. Start Claude Code with the bridge channel for idle delivery.',
      codex_to_claude_hook: claudeHooksInstalled
        ? 'Hook scripts exist; trusted hooks must be loaded before pending messages can arrive at the next hook event.'
        : 'Claude hook setup is incomplete or references missing scripts. Run connect_project to repair it; delivery is not established.',
      claude_to_codex: cli.ok
        ? `codex queue can accept messages, but acceptance does not prove Codex saw them. ${codexHook.observed ? 'A Codex hook has run in this project; it can inject a pending message at the next supported hook event.' : 'No Codex hook has run in this project, so active-turn delivery is unverified.'}`
        : `No codex queue executable is available. ${codexHook.observed ? 'A Codex hook has run in this project; it can claim pending messages at the next supported hook event.' : 'No Codex hook has run in this project either; messages only wait in the inbox.'}`
    },
    limits: { default_max_turns: DEFAULT_MAX_TURNS, max_turns_limit: MAX_TURNS_LIMIT,
      max_conversation_turns: maxConversationTurns(), config_path: bridgeConfigPath(), max_open_calls: MAX_OPEN_CALLS }
  };
}

function describeCodexSend(call, turn) {
  return {
    call_id: call.call_id, continued_from_call_id: call.continuation_of ?? null,
    chain_turn: (call.chain_turns_before ?? 0) + turn.turn,
    max_conversation_turns: maxConversationTurns(),
    chain_turns_remaining: Math.max(0, maxConversationTurns() - (call.chain_turns_before ?? 0) - turn.turn),
    message_id: turn.message_id, turn: turn.turn, max_turns: call.max_turns,
    turns_remaining: call.max_turns - turn.turn, state: call.state, to: turn.to,
    queued: turn.delivery?.queued === true,
    delivery_note: turn.to === 'channel:desktop'
      ? 'Queued for Claude Desktop. The chat sees it only when it calls read_codex_messages; no live push is available.'
      : parseEndpoint(turn.to).kind === 'channel'
        ? 'Pushed to the live Claude Code channel. It reaches the open session within about a second, even if Claude is idle.'
        : 'Queued for the Claude hook path. It arrives at that session\'s next hook event; an idle session gets nothing until it resumes.'
  };
}

function callClaude(args) {
  const root = projectRoot(args.project_path);
  if (!args.claude_endpoint || args.claude_endpoint === 'auto') throw new Error('Choose an existing Claude endpoint from list_sessions. Do not silently target the latest session.');
  const claude = resolveClaudeEndpoint(root, args.claude_endpoint);
  const codex = resolveCodexEndpoint(root, args.codex_endpoint ?? 'auto');
  const call = openCall(root, {
    subject: args.subject, opened_by: 'codex',
    claude_endpoint: claude.endpoint, codex_endpoint: codex.endpoint, max_turns: args.max_turns
  });
  const { call: updated, turn } = sendTurn(root, call.call_id, 'codex', args.message);
  return { ...describeCodexSend(updated, turn), subject: updated.subject, claude_path: claude.path, claude_live: claude.live };
}

function replyToClaude(args) {
  const root = projectRoot(args.project_path);
  const { call, turn } = sendTurn(root, readCall(root, args.call_id).call_id, 'codex', args.message);
  return describeCodexSend(call, turn);
}

function readCodexInbox(args) {
  const root = projectRoot(args.project_path);
  const { endpoint } = resolveCodexEndpoint(root, args.codex_endpoint ?? 'auto');
  const messages = takeInbox(root, 'codex', endpoint, 'codex-tool');
  return {
    codex_endpoint: endpoint, messages,
    note: messages.length
      ? 'These are now marked delivered. Reply with reply_to_claude using the call_id.'
      : 'Nothing pending. With trusted Codex hooks loaded for this same project, new messages can enter context at the next supported hook event.'
  };
}

function codexAckCall(args) {
  const root = projectRoot(args.project_path);
  const { call, turn } = ackTurn(root, args.call_id, args.message_id ?? null, args.note ?? 'seen', 'codex');
  return { call_id: call.call_id, acked_message_id: turn.message_id, acked_at: turn.acked_at, note: turn.ack_note };
}

function codexCloseCall(args) {
  const root = projectRoot(args.project_path);
  const call = closeCall(root, args.call_id, args.reason, 'codex');
  return { call_id: call.call_id, state: call.state, closed_by: call.closed_by, closed_reason: call.closed_reason };
}

function listCallsTool(args) {
  const root = projectRoot(args.project_path);
  const includeClosed = args.include_closed === true;
  return {
    calls: listCalls(root).filter(c => includeClosed || c.state === 'open')
      .sort((a, b) => (b.turns.at(-1)?.at ?? b.opened_at).localeCompare(a.turns.at(-1)?.at ?? a.opened_at))
      .slice(0, 20)
      .map(call => ({
        call_id: call.call_id, subject: call.subject, state: call.state, opened_by: call.opened_by,
        claude_endpoint: call.claude_endpoint, codex_endpoint: call.codex_endpoint,
        turns_used: call.turns.length, max_turns: call.max_turns,
        waiting_for: call.state !== 'open' ? null : (call.turns.at(-1)?.from === 'codex' ? 'claude' : 'codex'),
        last_turn_at: call.turns.at(-1)?.at ?? call.opened_at
      })),
    open_call_limit: MAX_OPEN_CALLS
  };
}

function watchCodexSession(args) {
  const root = projectRoot(args.project_path);
  const { endpoint } = resolveCodexEndpoint(root, args.codex_endpoint ?? 'auto');
  const cursor = Math.max(0, Math.floor(Number(args.after_cursor ?? 0) || 0));
  const log = readJsonl(codexSessionFile(root, parseEndpoint(endpoint).id));
  const batch = log.slice(cursor, cursor + 50);
  return { codex_endpoint: endpoint, events: batch, next_cursor: cursor + batch.length, more: log.length > cursor + batch.length };
}

const tools = [
  ...desktopActivityReadTools,
  { name: 'connect_project', description: 'Install non-blocking Claude Code hooks in local project settings, preserving existing settings.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'disconnect_project', description: 'Remove only claude-codex-live-bridge hooks from local project settings.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'list_sessions', description: 'List existing Claude Code sessions for this project with a prompt-based name when available, endpoint, and delivery path.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'watch_activity', description: 'Read new Claude Code activity after a cursor, optionally waiting up to 20 seconds.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, session_id: { type: 'string' }, after_cursor: { type: 'integer' }, wait_ms: { type: 'integer' } }, required: ['project_path', 'session_id'] } },
  { name: 'raise_hand', description: 'Queue a non-blocking concern for Claude to receive at the next hook event.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, session_id: { type: 'string' }, message: { type: 'string' } }, required: ['project_path', 'session_id', 'message'] } },
  { name: 'hand_status', description: 'Check whether a raised hand is queued or has been injected at a Claude hook point.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, session_id: { type: 'string' }, hand_id: { type: 'string' } }, required: ['project_path', 'session_id', 'hand_id'] } },
  { name: 'git_overlap', description: 'Compare local Git worktrees, branches, heads, and currently changed files for overlap.', inputSchema: { type: 'object', properties: { codex_path: { type: 'string' }, claude_path: { type: 'string' } }, required: ['codex_path', 'claude_path'] } },

  { name: 'connect_claude_channel', description: 'Register the bridge channel in <project>/.mcp.json so Claude Code can push-deliver messages to an idle session. Preserves other MCP servers.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'disconnect_claude_channel', description: 'Remove only this bridge\'s channel entry from <project>/.mcp.json.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'connect_codex_project', description: 'Install Codex-side hooks so Claude can observe this Codex session and Claude messages arrive as context. Writes <project>/.codex/hooks.json.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'codex_hook_event', description: 'Internal target for Codex lifecycle hooks. Records activity and returns pending peer context without blocking.', inputSchema: { type: 'object', properties: {
      project_path: { type: 'string' }, hook_event_name: { type: 'string' }, session_id: { type: 'string' }, cwd: { type: 'string' },
      turn_id: { type: 'string' }, tool_name: { type: 'string' }, tool_input: {}, tool_use_id: { type: 'string' },
      last_assistant_message: { type: ['string', 'null'] }
    }, required: ['hook_event_name', 'session_id', 'cwd'] } },
  { name: 'disconnect_codex_project', description: 'Remove only claude-codex-live-bridge hooks from the Codex hooks config.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'bridge_status', description: 'Show both directions of the bridge and which delivery paths actually work right now.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' } }, required: ['project_path'] } },
  { name: 'call_claude', description: 'Open a two-way call with a selected existing Claude Code session or live channel. Use list_sessions first; named sessions receive at their next hook event.', inputSchema: { type: 'object', properties: {
      project_path: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' },
      claude_endpoint: { type: 'string', description: 'Required session:<id> or channel:<id> selected from list_sessions' },
      codex_endpoint: { type: 'string', description: 'thread:<id> for this Codex session, or "auto"' },
      max_turns: { type: 'integer', description: `Turns per linked call segment (default ${DEFAULT_MAX_TURNS}, max ${MAX_TURNS_LIMIT}); a reply continues automatically when a segment fills.` }
    }, required: ['project_path', 'subject', 'message', 'claude_endpoint'] } },
  { name: 'reply_to_claude', description: 'Send the next turn. A full call segment continues automatically under a linked call ID; use the returned call_id for later replies.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, call_id: { type: 'string' }, message: { type: 'string' } }, required: ['project_path', 'call_id', 'message'] } },
  { name: 'read_codex_inbox', description: 'Claim any messages Claude addressed to this Codex thread, for when the hooks are not installed or not yet trusted.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, codex_endpoint: { type: 'string' } }, required: ['project_path'] } },
  { name: 'ack_call', description: 'Tell Claude you have seen a message but are not replying yet. Does not consume a turn.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, call_id: { type: 'string' }, message_id: { type: 'string' }, note: { type: 'string' } }, required: ['project_path', 'call_id'] } },
  { name: 'close_call', description: 'End a call so neither side sends more turns on it.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, call_id: { type: 'string' }, reason: { type: 'string' } }, required: ['project_path', 'call_id'] } },
  { name: 'call_status', description: 'Full state of one call: every turn, delivery, acknowledgement, and whether the peer is reachable.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, call_id: { type: 'string' } }, required: ['project_path', 'call_id'] } },
  { name: 'list_calls', description: 'List calls in this project and who each one is waiting for.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, include_closed: { type: 'boolean' } }, required: ['project_path'] } },
  { name: 'watch_codex_session', description: 'Read recorded activity for a Codex session, the mirror of watch_activity.', inputSchema: { type: 'object', properties: { project_path: { type: 'string' }, codex_endpoint: { type: 'string' }, after_cursor: { type: 'integer' } }, required: ['project_path'] } }
];
const actions = { connect_project: connectProject, disconnect_project: disconnectProject, list_sessions: listSessions,
  list_desktop_sessions: listDesktopActivity, watch_desktop_activity: watchDesktopActivity,
  watch_activity: watchActivity, raise_hand: raiseHand, hand_status: handStatus, git_overlap: gitOverlap,
  connect_claude_channel: args => connectClaudeChannel(projectRoot(args.project_path)),
  disconnect_claude_channel: args => disconnectClaudeChannel(projectRoot(args.project_path)),
  connect_codex_project: connectCodexProject, disconnect_codex_project: disconnectCodexProject, codex_hook_event: codexHookEvent,
  bridge_status: bridgeStatus, call_claude: callClaude, reply_to_claude: replyToClaude,
  read_codex_inbox: readCodexInbox, ack_call: codexAckCall, close_call: codexCloseCall,
  call_status: args => callStatus(projectRoot(args.project_path), args.call_id),
  list_calls: listCallsTool, watch_codex_session: watchCodexSession };

function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  if (request.id === undefined) continue;
  try {
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'claude-live-bridge', version: '0.3.0-beta.5' } };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'tools/call') {
      const action = actions[request.params?.name];
      if (!action) throw new Error('Unknown tool');
      const value = await action(request.params?.arguments ?? {});
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } else throw new Error(`Unsupported method: ${request.method}`);
    send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } });
  }
}
