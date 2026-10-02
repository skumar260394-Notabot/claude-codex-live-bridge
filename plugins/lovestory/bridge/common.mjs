import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hookPath = fileURLToPath(new URL('./hook.mjs', import.meta.url));

export function projectRoot(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('project_path is required');
  const root = resolve(input);
  if (!existsSync(root)) throw new Error(`Project path does not exist: ${root}`);
  return root;
}

export function projectDir(root) {
  const key = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex').slice(0, 20);
  return join(homedir(), '.codex-claude-live', key);
}

export function safeSessionId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid session_id');
  return id;
}

export function sessionFile(root, id) {
  return join(projectDir(root), 'sessions', `${safeSessionId(id)}.jsonl`);
}

export function handDir(root, id, kind = 'pending') {
  return join(projectDir(root), 'hands', kind, safeSessionId(id));
}

export function atomicJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
  renameSync(temp, path);
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function appendEvent(root, id, event) {
  const file = sessionFile(root, id);
  mkdirSync(resolve(file, '..'), { recursive: true });
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
}

export function listHandFiles(root, id, kind) {
  const dir = handDir(root, id, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => join(dir, name));
}

export function takePendingHands(root, id) {
  const taken = [];
  for (const source of listHandFiles(root, id, 'pending')) {
    const target = join(handDir(root, id, 'delivered'), source.split(/[\\/]/).at(-1));
    mkdirSync(handDir(root, id, 'delivered'), { recursive: true });
    try {
      renameSync(source, target);
      const hand = readJson(target);
      hand.delivered_at = new Date().toISOString();
      atomicJson(target, hand);
      taken.push(hand);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return taken;
}

export function redactSecrets(value) {
  let text = String(value ?? '');
  text = text.replace(/(sk-(?:ant-)?[A-Za-z0-9_-]{12,})/g, '[redacted]');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]');
  text = text.replace(/((?:API_KEY|TOKEN|PASSWORD|SECRET)\s*[=:]\s*)\S+/gi, '$1[redacted]');
  return text;
}

export function sanitizeSummary(value, limit = 240) {
  const text = redactSecrets(String(value ?? '').replace(/\s+/g, ' ').trim());
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// Keeps paragraph structure for a message body, unlike sanitizeSummary.
export function sanitizeBody(value, limit = 4000) {
  const text = redactSecrets(String(value ?? '').replace(/\r\n/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')).trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
