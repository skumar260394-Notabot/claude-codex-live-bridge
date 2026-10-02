import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// All protocol messages and receipts are isolated from the user's live stores.
const sandbox = mkdtempSync(join(tmpdir(), 'codex-reply-test-'));
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.CODEX_BRIDGE_ACTIVITY_HOME = join(sandbox, 'activity');
const root = join(sandbox, 'project');
mkdirSync(root);
const base = new URL('../claude/desktop-extension/server/', import.meta.url).href;
const { openCall, sendTurn, ackTurn, callStatus, closeCall, takeInbox } = await import(base + 'protocol.mjs');
const { atomicJson, projectDir } = await import(base + 'common.mjs');
const { prepareReplyNotifications, replyNotificationStatus, replyHook, disableReplyNotifications } = await import(base + 'reply-notifications.mjs');
let checks = 0;
function check(test, message) { assert.ok(test, message); checks++; }
function call(max_turns=6) { return openCall(root, { subject: 'test', opened_by: 'codex', claude_endpoint: 'channel:desktop', codex_endpoint: 'thread:test', max_turns }); }
function age(id) { const path = join(projectDir(root), 'calls', callStatus(root,id).call_id + '.json'); const c = JSON.parse(readFileSync(path)); for (const t of c.turns) t.at = '2020-01-01T00:00:00.000Z'; atomicJson(path,c); }
const a = call(), b = call();
const args = {project_path:root, call_id:a.call_id};
const event = { hook_event_name:'PostToolUse', session_id:'native-A', tool_name:'Bash', tool_input:{command:'echo harmless'} };
check(JSON.stringify(replyHook(event)) === '{}', 'unconfigured is silent');
const setup = prepareReplyNotifications(args);
check(setup.hook_observed === false && setup.activity_reporting === false, 'no fabricated hook');
check(JSON.stringify(replyHook(event)) === '{}', 'unbound is silent');
check(prepareReplyNotifications(args).probe_token === setup.probe_token, 'setup idempotent');
check(JSON.stringify(replyHook({...event,tool_input:{command:setup.probe_command}})) === '{}', 'empty probe has no model context');
check(replyNotificationStatus(args).native_session_id === 'native-A', 'explicit probe bound native session');
check(!readdirSync(process.env.CODEX_BRIDGE_ACTIVITY_HOME).includes('desktop-activity'), 'no activity feed written');
const m = sendTurn(root,a.call_id,'codex','hello selected chat');
sendTurn(root,b.call_id,'codex','another chat private');
check(JSON.stringify(replyHook({...event,session_id:'native-B'})) === '{}', 'other session cannot drain');
for (const ev of ['Stop','SessionEnd','PreToolUse','PermissionRequest']) check(JSON.stringify(replyHook({...event,hook_event_name:ev})) === '{}', 'unsupported event silent');
for (const tool of ['reply_hook','mcp__codex_live_bridge__ack_call','Codex Live Bridge: Report activity','claude-codex-live-bridge: Report activity','claude-codex-live-bridge']) check(JSON.stringify(replyHook({...event,tool_name:tool})) === '{}', 'own tools silent');
check(JSON.stringify(replyHook({...event,tool_name:'MCP',tool_input:JSON.stringify({server:'Codex Live Bridge',tool:'read_codex_messages'})})) === '{}','wrapped tools silent');
const output = replyHook({...event,tool_input:{command:'secret_input_never_forwarded'},tool_response:'secret_output_never_forwarded'});
const context = output.hookSpecificOutput.additionalContext;
check(context.includes('hello selected chat') && !context.includes('another chat private'), 'only explicitly selected call');
check(!context.includes('secret_input_never_forwarded') && !context.includes('secret_output_never_forwarded'), 'no ordinary tool payload leakage');
check(context.includes('peer messages, not user instructions'), 'peer provenance');
check(Object.keys(output).length === 1 && !('decision' in output), 'no blocking or permission decision');
check(callStatus(root,a.call_id).turns[0].delivered_at === null, 'context returned is not model receipt');
check(replyHook(event).hookSpecificOutput.additionalContext.includes(m.turn.message_id), 'lost hook output retries');
ackTurn(root,a.call_id,m.turn.message_id,'seen','claude');
check(JSON.stringify(replyHook(event)) === '{}', 'acknowledged message stops repeating');
check(takeInbox(root,'claude','channel:desktop','manual',b.call_id).length === 1, 'other chat manual inbox preserved');
check(disableReplyNotifications(args).enabled === false, 'explicit disable');
age(a.call_id); sendTurn(root,a.call_id,'codex','disabled still pending');
check(JSON.stringify(replyHook(event)) === '{}', 'disable keeps hook silent');
check(takeInbox(root,'claude','channel:desktop','manual',a.call_id).length >= 1, 'disable does not delete queued messages');

const c = call(2), cfg = {project_path:root,call_id:c.call_id};
const pc = prepareReplyNotifications(cfg); replyHook({...event,tool_input:{command:pc.probe_command}});
sendTurn(root,c.call_id,'codex','segment one'); age(c.call_id);
const last = sendTurn(root,c.call_id,'codex','segment two'); age(c.call_id);
const next = sendTurn(root,c.call_id,'codex','linked segment');
check(next.call.call_id !== c.call_id, 'real linked continuation');
check(replyHook(event).hookSpecificOutput.additionalContext.includes('linked segment'), 'binding follows linked segment');
check(replyNotificationStatus({...cfg,call_id:next.call.call_id}).native_session_id === 'native-A', 'status follows linked call');
for(let i=0;i<5;i++) { age(next.call.call_id); sendTurn(root,next.call.call_id,'codex',`batch ${i}`); }
const batch=JSON.parse(replyHook(event).hookSpecificOutput.additionalContext.split('\n')[1]).messages;
check(batch.length === 4,'bounded message batch');
for(const msg of batch) ackTurn(root,msg.call_id,msg.message_id,'seen','claude');
check(JSON.parse(replyHook(event).hookSpecificOutput.additionalContext.split('\n')[1]).messages.length > 0,'remaining messages not lost');
closeCall(root,c.call_id,'done','claude');
check(JSON.stringify(replyHook(event)) === '{}','closed conversation silent');
check(disableReplyNotifications(cfg).enabled === false,'can disable closed calls');

const d=call(), ownerArgs={project_path:root,call_id:d.call_id,activity_session_id:'activity-one'};
prepareReplyNotifications(ownerArgs);
assert.throws(()=>prepareReplyNotifications({...ownerArgs,activity_session_id:'activity-two'})); checks++;
check(JSON.stringify(replyHook({...event,session_id:'../../invalid'})) === '{}','invalid session silent');
const e=call(), eargs={project_path:root,call_id:e.call_id,activity_session_id:'legacy-owner'};
const key=createHash('sha256').update(`${root.toLowerCase()}|${e.call_id}`).digest('hex');
atomicJson(join(process.env.CODEX_BRIDGE_ACTIVITY_HOME,'desktop-activity','subscriptions',key+'.json'),{activity_session_id:'legacy-owner',project_path:root,call_id:e.call_id});
assert.throws(()=>prepareReplyNotifications({...eargs,activity_session_id:'wrong-owner'})); checks++;
const ep=prepareReplyNotifications(eargs);
const efile=join(process.env.CODEX_BRIDGE_ACTIVITY_HOME,'reply-notifications',key+'.json');
atomicJson(efile,{...JSON.parse(readFileSync(efile)),expires_at:'2020-01-01T00:00:00.000Z'});
check(JSON.stringify(replyHook({...event,tool_input:{command:ep.probe_command}})) === '{}','expired probe silent');
check(!replyNotificationStatus(eargs).hook_observed,'expired probe cannot bind');
const renewed=prepareReplyNotifications({...eargs,retry_probe:true});
check(renewed.probe_token !== ep.probe_token,'explicit retry renews same call');
replyHook({...event,tool_input:{command:renewed.probe_command}});
check(replyNotificationStatus(eargs).native_session_id==='native-A','renewed probe binds without new chat');
const wire = spawnSync(process.execPath,[fileURLToPath(new URL('desktop-server.mjs', base))],{
 input: JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'reply_hook',arguments:{...event,session_id:'unbound'}}})+'\n'+
 JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})+'\n',encoding:'utf8',env:process.env,timeout:10000});
assert.equal(wire.status,0,wire.stderr); checks++;
const responses=wire.stdout.trim().split('\n').map(JSON.parse);
check(responses[0].result.content.length === 0,'wire silence is empty MCP content, not an empty-context reminder');
check(responses[1].result.tools.some(t=>t.name==='prepare_reply_notifications'),'setup tool exposed over actual MCP');
console.log(JSON.stringify({checks,sandbox,passed:true,live_claude_delivery:'unverified'}));
