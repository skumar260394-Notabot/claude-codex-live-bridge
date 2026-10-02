// Read only the newest compatible Codex state database; never revive deleted
// chats from an older database or the append-only title index.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, win32 } from 'node:path';
import { sanitizeSummary } from './common.mjs';

export function absoluteLocalPath(value) {
  const text = String(value ?? '');
  const drive = text.match(/[A-Za-z]:[\\/].*$/)?.[0];
  return drive ? win32.normalize(drive) : isAbsolute(text) ? normalize(text) : null;
}
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;

export async function readCodexChats({ home = process.env.CODEX_HOME || join(homedir(), '.codex'), root = null } = {}) {
  const names = new Map();
  const discovery = { database: null, authoritative: false, warnings: [] };
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { discovery.warnings.push('Named chat routing requires Node.js 22.13.0 or newer with node:sqlite. Upgrade the extension runtime.'); }
  let candidates = [];
  try { candidates = readdirSync(home).filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0])); }
  catch { discovery.warnings.push('No local Codex state directory is available.'); }
  if (DatabaseSync) for (const candidate of candidates) {
    let db;
    try {
      db = new DatabaseSync(join(home, candidate), { readOnly: true });
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
      if (!['id', 'cwd', 'archived'].every(key => columns.has(key))) throw new Error('incompatible threads schema');
      const selected = ['id', 'cwd', ...['name', 'title', 'updated_at'].filter(key => columns.has(key))];
      const rows = db.prepare(`SELECT ${selected.join(', ')} FROM threads WHERE archived = 0`).all();
      for (const row of rows) {
        const project = absoluteLocalPath(row.cwd);
        if (!project || (root && pathKey(project) !== pathKey(root))) continue;
        try { if (!statSync(project).isDirectory()) continue; } catch { continue; }
        const title = row.name || row.title;
        const timestamp = Number(row.updated_at) * 1000;
        names.set(row.id, { name: title ? sanitizeSummary(title, 120) : null, project_path: project,
          verified_project: true, updated_at: Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp).toISOString() : null });
      }
      discovery.database = candidate;
      discovery.authoritative = true;
      break;
    } catch (error) { names.clear(); discovery.warnings.push(`${candidate}: ${sanitizeSummary(error.message, 180)}`); }
    finally { db?.close(); }
  }
  if (!discovery.authoritative) {
    discovery.warnings.push('No compatible Codex database was read. Index titles alone cannot verify a routable project.');
    try { for (const line of readFileSync(join(home, 'session_index.jsonl'), 'utf8').split('\n')) {
      try { const row = JSON.parse(line); if (row.id && row.thread_name) names.set(row.id, {
        name: sanitizeSummary(row.thread_name, 120), project_path: null, verified_project: false,
        updated_at: row.updated_at ?? null }); } catch { /* partial index line */ }
    } } catch { /* optional index */ }
  }
  return { names, discovery };
}
