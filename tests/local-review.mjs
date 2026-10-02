import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readCodexChats } from '../plugins/claude-codex-live-bridge/bridge/codex-sessions.mjs';
import { protectLocalConfigs } from '../plugins/claude-codex-live-bridge/bridge/local-config.mjs';
import { checkCodexQueue } from '../plugins/claude-codex-live-bridge/bridge/codex-cli.mjs';
import { prepareReplyNotifications } from '../claude/desktop-extension/server/reply-notifications.mjs';
import { openCall } from '../plugins/claude-codex-live-bridge/bridge/protocol.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'bridge-local-review-'));
const home = join(sandbox, 'codex');
const project = join(sandbox, 'project [special] with spaces');
mkdirSync(home); mkdirSync(project);
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
function database(version, withName, rows) {
  const db = new DatabaseSync(join(home, `state_${version}.sqlite`));
  db.exec(`CREATE TABLE threads (id TEXT, cwd TEXT, archived INTEGER, title TEXT${withName ? ', name TEXT' : ''})`);
  for (const [id, archived, title] of rows) db.prepare('INSERT INTO threads (id,cwd,archived,title) VALUES (?,?,?,?)').run(id, project, archived, title);
  db.close();
}
database(5, true, [['old', 0, 'Old snapshot']]);
database(6, false, [['new', 0, 'Selected chat'], ['archived', 1, 'Archived']]);
writeFileSync(join(home, 'session_index.jsonl'), JSON.stringify({id:'deleted',thread_name:'Deleted chat'})+'\n');
const selected = await readCodexChats({home});
check(selected.discovery.database === 'state_6.sqlite', 'newest compatible version selected');
check(selected.names.size === 1 && selected.names.has('new'), 'no archived, deleted-index or old database ghosts');
check(selected.names.get('new').name === 'Selected chat', 'title-only schema supported');
check(selected.names.get('new').verified_project, 'existing project verified');
writeFileSync(join(home, 'state_7.sqlite'), 'not a database');
const fallback = await readCodexChats({home});
check(fallback.discovery.database === 'state_6.sqlite' && fallback.discovery.warnings.some(s=>s.startsWith('state_7')), 'incompatible newer database is diagnosed');
const broken = join(sandbox, 'broken'); mkdirSync(broken);
writeFileSync(join(broken,'state_8.sqlite'),'broken');
writeFileSync(join(broken,'session_index.jsonl'),JSON.stringify({id:'index',thread_name:'Unverified'})+'\n');
const titles = await readCodexChats({home:broken});
check(!titles.discovery.authoritative && !titles.names.get('index').verified_project && titles.discovery.warnings.length > 0, 'title fallback cannot silently become a routing destination');

const git = args => execFileSync('git',['-C',project,...args],{encoding:'utf8',windowsHide:true}).trim();
git(['init','--quiet']);
const settings = join(project,'.mcp.json');
const hook = join(project,'.codex','hooks.json');
mkdirSync(join(project,'.codex')); writeFileSync(settings,'{}');writeFileSync(hook,'{}');
const privacy = protectLocalConfigs(project,[settings,hook]);
check(privacy.git_repository && git(['check-ignore',settings,hook]).split('\n').length === 2, 'machine configs ignored in local Git exclude');
const excludeBefore = readFileSync(privacy.exclude_path,'utf8');
protectLocalConfigs(project,[settings,hook]);
check(readFileSync(privacy.exclude_path,'utf8')===excludeBefore,'local exclusions are idempotent');
git(['add','-f','.mcp.json']);
assert.throws(()=>protectLocalConfigs(project,[settings,hook]),/tracked files/); checks++;
check(readFileSync(settings,'utf8') === '{}' && readFileSync(privacy.exclude_path,'utf8') === excludeBefore,'tracked-file refusal preserves settings and exclusions');
const nested=join(project,'nested folder [x]');mkdirSync(nested);
const nestedSettings=join(nested,'.mcp.json');writeFileSync(nestedSettings,'{}');
protectLocalConfigs(nested,[nestedSettings]);
check(git(['check-ignore',nestedSettings]).length>0,'nested workspaces and literal glob characters are escaped');
git(['--literal-pathspecs','add','-f',nestedSettings]);
assert.throws(()=>protectLocalConfigs(nested,[nestedSettings]),/tracked files/); checks++;

const supported=join(sandbox,'supported.mjs'), unsupported=join(sandbox,'unsupported.mjs');
writeFileSync(supported,"console.log('queue --thread <id> --message <text>');");
writeFileSync(unsupported,"console.error('unknown command queue'); process.exit(1);");
check(checkCodexQueue({ok:true,path:supported}).queue_supported===true,'compatible command detected without sending');
check(checkCodexQueue({ok:true,path:unsupported}).ok===false,'executable existence does not imply queue support');

const call=openCall(project,{subject:'probe',opened_by:'codex',claude_endpoint:'channel:desktop',codex_endpoint:'thread:synthetic'});
const probe=prepareReplyNotifications({project_path:project,call_id:call.call_id});
const shell=process.platform==='win32'?'powershell.exe':'sh';
const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',probe.probe_command]:['-c',probe.probe_command];
const run=spawnSync(shell,args,{encoding:'utf8',windowsHide:true,timeout:10000});
check(run.status===0 && run.stdout.trim()===probe.probe_token,'returned probe command runs in the actual native shell');
if(process.platform==='win32') {
  const cmd=spawnSync('cmd.exe',['/d','/s','/c',`"${probe.probe_command}"`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:10000});
  check(cmd.status===0 && cmd.stdout.trim()===probe.probe_token,'same probe runs in Windows cmd');
}
console.log(`Local review regressions passed (${checks} checks). No live model calls.`);
