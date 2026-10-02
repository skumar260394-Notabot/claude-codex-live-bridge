import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const version = json('plugins/lovestory/plugin.json').version;
const failures = [];
let files = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'dist', 'node_modules', '__pycache__'].includes(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) { walk(path); continue; }
    files++;
    const name = relative(root, path);
    if (['auth.json', '.env'].includes(item.name) || /\.(log|tmp|pyc)$/.test(item.name)) failures.push(`${name}: private/runtime file`);
    const text = readFileSync(path, 'utf8');
    // Real user directories and complete secret values are forbidden; synthetic test text is allowed.
    if (/[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9]/i.test(text) || /\/home\/[a-z][a-z0-9_-]*\//i.test(text)) failures.push(`${name}: personal absolute path`);
    if (/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}/.test(text)) failures.push(`${name}: credential-shaped value`);
    if (name.endsWith('.json')) { try { JSON.parse(text); } catch { failures.push(`${name}: invalid JSON`); } }
    if (name.endsWith('.mjs')) {
      const run = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (run.status !== 0) failures.push(`${name}: ${run.stderr}`);
    }
  }
}
walk(root);
assert.equal(json('plugins/lovestory/.codex-plugin/plugin.json').name, 'lovestory');
assert.equal(json('claude/desktop-extension/manifest.json').display_name, 'lovestory');
for (const manifest of ['plugins/lovestory/.codex-plugin/plugin.json', 'claude/desktop-extension/manifest.json', 'claude/alerts/.claude-plugin/plugin.json']) assert.equal(json(manifest).version, version);
const marketplace = json('.agents/plugins/marketplace.json');
assert.equal(marketplace.plugins[0].name, 'lovestory');
assert.ok(existsSync(join(root, marketplace.plugins[0].source.path)));
const hooks = json('claude/alerts/hooks/hooks.json').hooks;
assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']);
for (const groups of Object.values(hooks)) for (const group of groups) for (const hook of group.hooks) {
  assert.equal(hook.type, 'mcp_tool'); assert.equal(hook.tool, 'reply_hook'); assert.equal(hook.server, 'lovestory');
}
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`Source check passed: ${files} files, aligned ${version} manifests, no personal paths or credential patterns.`);
