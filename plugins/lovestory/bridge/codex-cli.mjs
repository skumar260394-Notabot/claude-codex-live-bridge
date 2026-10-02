import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

function file(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

// Resolve on every status/send. Codex app upgrades remove old hashed folders.
// Keep explicit valid overrides (including JS test/launcher entry points), but
// do not let a missing override disable all other discovery routes.
export function findCodexCli({ env = process.env, platform = process.platform, userHome = homedir() } = {}) {
  const override = env.CODEX_BRIDGE_CLI;
  const compatibility = override && file(override) && file(join(dirname(override), '.claude-live-bridge-compatibility.json'));
  if (override && file(override) && !compatibility) return { ok: true, path: override, source: 'CODEX_BRIDGE_CLI' };
  const ignored = override ? { ignored_override: override, warning: compatibility
    ? 'Configured path is a temporary bridge compatibility alias; using automatic discovery.'
    : 'Configured CODEX_BRIDGE_CLI is missing or not a file; using automatic discovery.' } : {};
  const found = (path, source) => ({ ok: true, path, source, ...ignored });
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';

  // The desktop application's CLI can support queue even when an npm CLI on
  // PATH is older. Inspect only its known local bin directory, not the disk.
  if (platform === 'win32') {
    const bin = join(env.LOCALAPPDATA || join(userHome, 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    let entries = [];
    try { entries = readdirSync(bin, { withFileTypes: true }); } catch {}
    const candidates = entries.filter(entry => entry.isDirectory()).flatMap(entry => {
      const directory = join(bin, entry.name);
      if (file(join(directory, '.claude-live-bridge-compatibility.json'))) return [];
      const path = join(directory, exe);
      try {
        const binary = statSync(path);
        return binary.isFile() ? [{ path, modified: Math.max(binary.mtimeMs, statSync(directory).mtimeMs) }] : [];
      } catch { return []; }
    }).sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
    if (candidates.length) return found(candidates[0].path, 'codex-app');
  }

  const dirs = String(env.PATH || '').split(delimiter).filter(Boolean);
  for (const directory of dirs) {
    const path = join(directory, exe);
    if (file(path)) return found(path, 'PATH');
  }
  // Never pass peer/model text through npm's .cmd/.ps1 shell shims.
  for (const directory of dirs) {
    const vendor = join(directory, 'node_modules', '@openai', 'codex', 'node_modules', '@openai');
    let packages = [];
    try { packages = readdirSync(vendor); } catch { continue; }
    for (const name of packages) {
      const base = join(vendor, name, 'vendor');
      let triples = [];
      try { triples = readdirSync(base); } catch { continue; }
      for (const triple of triples) {
        const path = join(base, triple, 'bin', exe);
        if (file(path)) return found(path, 'npm-vendor');
      }
    }
  }
  return { ok: false, ...ignored, reason: 'No Codex executable found in the app installation, PATH, or npm vendor folders. Set CODEX_BRIDGE_CLI to an existing executable or JavaScript entry point.' };
}
