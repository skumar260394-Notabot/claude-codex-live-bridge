import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function canonicalPath(path) {
  let current = resolve(path);
  const missing = [];
  for (;;) {
    try { return join(realpathSync.native(current), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(current) === current) throw error;
      missing.push(basename(current));
      current = dirname(current);
    }
  }
}

// Keep per-machine launch paths out of shared Git history without changing
// the project's shared ignore rules or untracking anyone's existing files.
export function protectLocalConfigs(root, paths) {
  let gitDirectory = root;
  const git = args => execFileSync('git', ['--literal-pathspecs', '-C', gitDirectory, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  let top;
  try { top = canonicalPath(git(['rev-parse', '--show-toplevel'])); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git is required to protect generated machine-local configuration. Install Git before connecting a project.');
    if (!String(error.stderr).includes('not a git repository')) throw error;
    return { git_repository: false, ignored_paths: [] };
  }
  gitDirectory = top;
  const entries = paths.map(path => {
    const name = relative(top, canonicalPath(path)).split(sep).join('/');
    if (!name || name.startsWith('../') || isAbsolute(name)) throw new Error('Configuration path is outside the selected Git repository.');
    return name;
  });
  const tracked = entries.filter(name => git(['ls-files', '--', name]).length > 0);
  if (tracked.length) throw new Error(`Refusing to write machine-local settings into tracked files: ${tracked.join(', ')}. Keep shared configuration portable; use Claude's local MCP scope or move these settings out of version control before connecting.`);
  const exclude = resolve(top, git(['rev-parse', '--git-path', 'info/exclude']));
  let current = '';
  try { current = readFileSync(exclude, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = new Set(current.split(/\r?\n/));
  // Git ignore syntax needs escaping for folders with spaces or glob characters.
  const patterns = entries.map(name => '/' + name.replace(/[\\*?\[\]#! ]/g, char => '\\' + char));
  const added = patterns.filter(pattern => !existing.has(pattern));
  if (added.length) {
    mkdirSync(dirname(exclude), { recursive: true });
    writeFileSync(exclude, current + (current && !current.endsWith('\n') ? '\n' : '') + added.join('\n') + '\n');
  }
  return { git_repository: true, ignored_paths: entries, exclude_path: exclude };
}
