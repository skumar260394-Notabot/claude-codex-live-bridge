import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { atomicJson, readJson, safeSessionId, sanitizeSummary } from './common.mjs';

// Activity is independent of call routing and of a project's working files.
const store = () => join(process.env.CODEX_BRIDGE_ACTIVITY_HOME || join(homedir(), '.codex-claude-live'), 'desktop-activity');
const metadataPath = id => join(store(), `${safeSessionId(id)}.json`);
const eventsPath = id => join(store(), `${safeSessionId(id)}.jsonl`);
const hookEvents = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd']);
const statuses = new Set(['working', 'waiting', 'idle', 'completed', 'error']);

function log(id) {
  const file = eventsPath(id);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function append(id, entry) {
  mkdirSync(store(), { recursive: true });
  const event = { at: new Date().toISOString(), ...entry };
  appendFileSync(eventsPath(id), JSON.stringify(event) + '\n', 'utf8');
  return event;
}

function project(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('project_path must be an absolute local folder, or omitted.');
  return value;
}

export function registerDesktopActivity(args) {
  const id = safeSessionId(args.activity_session_id || randomUUID());
  const name = sanitizeSummary(args.name, 160);
  if (!name) throw new Error('Provide the name of this Claude chat or task. Do not infer another chat.');
  const previous = readJson(metadataPath(id), {});
  const value = { ...previous, activity_session_id: id, name, name_source: 'claude_reported',
    surface: args.surface || previous.surface || 'desktop',
    project_path: args.project_path === undefined ? previous.project_path ?? null : project(args.project_path),
    registered_at: previous.registered_at || new Date().toISOString() };
  if (!['desktop', 'cowork'].includes(value.surface)) throw new Error('surface must be desktop or cowork.');
  atomicJson(metadataPath(id), value);
  return { ...value, capture: 'progress_reports',
    note: 'Keep this activity_session_id in this conversation. Progress reports do not expose unreported work or wake either assistant. Use a native session ID supplied by the activity hook to combine automatic events and reports.' };
}

export function reportDesktopActivity(args) {
  const id = safeSessionId(args.activity_session_id);
  if (!readJson(metadataPath(id), null)) throw new Error('Register this activity session first.');
  if (!statuses.has(args.status)) throw new Error('Invalid activity status.');
  const action = sanitizeSummary(args.action, 600);
  if (!action) throw new Error('Provide a brief description of the current action or result.');
  const event = append(id, { source: 'claude_report', event: 'Progress', status: args.status, action,
    ...(args.tool_name ? { tool: sanitizeSummary(args.tool_name, 160) } : {}),
    files: Array.isArray(args.files) ? args.files.slice(0, 20).map(v => sanitizeSummary(v, 300)) : [] });
  return { activity_session_id: id, recorded: true, at: event.at, source: event.source };
}

function object(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch {} }
  return {};
}

export function captureDesktopHook(args) {
  const id = safeSessionId(args.session_id);
  const event = args.hook_event_name;
  if (!hookEvents.has(event)) throw new Error('Unsupported activity hook event.');
  const tool = sanitizeSummary(args.tool_name, 160);
  // The reporter's own tool calls are not work events and must not create a loop.
  if (/activity_hook|report_activity|register_activity_session|subscribe_codex_call/.test(tool)) return {};
  const input = object(args.tool_input);
  const meta = readJson(metadataPath(id), null);
  if (!meta) atomicJson(metadataPath(id), { activity_session_id: id, name: null, name_source: null,
    surface: 'cowork', project_path: null, registered_at: new Date().toISOString() });
  const action = sanitizeSummary(input.description || input.file_path || input.path || input.command || tool || event, 600);
  const status = event === 'Stop' || event === 'SessionEnd' ? 'idle' : event === 'PostToolUseFailure' ? 'error' : 'working';
  append(id, { source: 'cowork_hook', event, status, action, ...(tool ? { tool } : {}),
    ...(args.tool_use_id ? { tool_use_id: sanitizeSummary(args.tool_use_id, 160) } : {}),
    ...(event === 'Stop' && args.last_assistant_message ? { message: sanitizeSummary(args.last_assistant_message, 2000) } : {}),
    ...(event === 'PostToolUseFailure' && args.error ? { error: sanitizeSummary(args.error, 300) } : {}) });
  // A first observed hook gives Claude its native identity for naming the feed.
  if (!meta && event !== 'SessionEnd') return { hookSpecificOutput: { hookEventName: event,
    additionalContext: `lovestory recorded a Cowork activity hook for this task. Its activity_session_id is ${id}. This identity can be labeled through register_activity_session with the task name supplied by the user. Activity recording is separate from message delivery.` } };
  return {};
}

export function listDesktopActivity(args = {}) {
  const query = String(args.query || '').trim().toLowerCase();
  const root = project(args.project_path);
  const sessions = (existsSync(store()) ? readdirSync(store()) : []).filter(name => name.endsWith('.json')).flatMap(name => {
    const meta = readJson(join(store(), name), null);
    if (!meta?.activity_session_id) return [];
    if (root && root.toLowerCase() !== meta.project_path?.toLowerCase()) return [];
    if (query && !`${meta.name || ''} ${meta.activity_session_id}`.toLowerCase().includes(query)) return [];
    const events = log(meta.activity_session_id);
    const last = events.at(-1);
    const hook = [...events].reverse().find(e => e.source === 'cowork_hook');
    const subscriptions = join(store(), 'subscriptions');
    const subscribed = (existsSync(subscriptions) ? readdirSync(subscriptions) : [])
      .filter(file => file.endsWith('.json')).map(file => readJson(join(subscriptions, file), null))
      .filter(value => value?.activity_session_id === meta.activity_session_id)
      .map(({ project_path, call_id }) => ({ project_path, call_id }));
    return [{ ...meta, event_count: events.length, hook_observed: !!hook,
      subscribed_calls: subscribed,
      last_hook_at: hook?.at || null, coverage: hook ? 'observed_hook_events_and_reports' : 'progress_reports_only',
      last_event_at: last?.at || null, last_action: last?.action || null, last_status: last?.status || null,
      stale: !last || Date.now() - Date.parse(last.at) > 120000,
      note: 'last_status is the last recorded state, not proof the task is running now. Names and project folders are declared by Claude; activity IDs are not message-routing endpoints.' }];
  }).sort((a, b) => (b.last_event_at || '').localeCompare(a.last_event_at || '')).slice(0, 100);
  return { sessions, project_required: false };
}

export function watchDesktopActivity(args) {
  const id = safeSessionId(args.activity_session_id);
  const metadata = readJson(metadataPath(id), null);
  if (!metadata) throw new Error('Unknown activity session. Choose one from list_desktop_sessions.');
  const all = log(id);
  const cursor = Math.max(0, Math.floor(Number(args.after_cursor) || 0));
  const events = all.slice(cursor, cursor + 50);
  return { ...metadata, events, next_cursor: cursor + events.length, more: all.length > cursor + events.length,
    hook_observed: all.some(e => e.source === 'cowork_hook'),
    note: 'Only recorded events are visible. A quiet feed does not prove Claude is idle, and progress reports are not automatic observation.' };
}

export const desktopActivityReadTools = [
  { name: 'list_desktop_sessions', description: 'Find Claude Desktop or Cowork activity feeds by name across projects. Shows hook observation and reported-only coverage; does not provide messaging endpoints.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, project_path: { type: 'string' } } } },
  { name: 'watch_desktop_activity', description: 'Read recorded Claude Desktop/Cowork activity after a cursor. Each event identifies whether it came from a hook or a Claude progress report.', inputSchema: { type: 'object', properties: { activity_session_id: { type: 'string' }, after_cursor: { type: 'integer', minimum: 0 } }, required: ['activity_session_id'] } }
];

export const desktopActivityWriteTools = [
  { name: 'register_activity_session', description: 'Register or label THIS Claude chat/task so Codex can find its activity by name. Keep the returned ID in this conversation; project is optional and never changes message routing.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, activity_session_id: { type: 'string' }, project_path: { type: 'string' }, surface: { type: 'string', enum: ['desktop', 'cowork'] } }, required: ['name'] } },
  { name: 'report_activity', description: 'Publish a brief current action, result, or blocker for this registered task. This is reported progress, not automatic observation. Do not include credentials or hidden reasoning.', inputSchema: { type: 'object', properties: { activity_session_id: { type: 'string' }, status: { type: 'string', enum: [...statuses] }, action: { type: 'string' }, tool_name: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['activity_session_id', 'status', 'action'] } },
  { name: 'activity_hook', description: 'Internal Cowork lifecycle target: record a tool/event summary and return optional identity context. Never blocks, approves tools, or claims bridge messages.', inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, hook_event_name: { type: 'string', enum: [...hookEvents] }, tool_name: { type: 'string' }, tool_input: {}, tool_use_id: { type: 'string' }, last_assistant_message: { type: ['string', 'null'] }, error: { type: ['string', 'null'] } }, required: ['session_id', 'hook_event_name'] } }
];
