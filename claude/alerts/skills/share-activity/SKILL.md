---
name: share-activity
description: Configure reply-only Codex raised hands for this existing Claude chat; activity reporting is off by default.
---

# Reply notifications; activity reports are optional

This skill name is retained for update compatibility. The companion no longer
asks Claude to publish reports or poll after each tool. Use desktop extension
claude-codex-live-bridge 0.3.0-beta.4 or later.

1. Retain this conversation and its explicitly selected open bridge call. Do
   not guess another chat, call, activity ID, or newest session.
2. Call prepare_reply_notifications with that call_id and project_path if
   needed. If an older subscription owns this call, supply this conversation's
   existing activity_session_id. That ID is ownership metadata, not a native
   runtime ID; do not pretend they are the same.
3. Run the returned harmless probe_command using this chat's ordinary command
   tool. The next PostToolUse callback must reach the desktop connector to bind
   this native session. Then call reply_notification_status with the call_id.
   Never call reply_hook manually to manufacture a hook observation.
4. If hook_observed is false, stop setup and report that direct notifications
   are unavailable or unverified in this host. Do not restore repetitive
   polling reminders, schedule a timer, or open a replacement chat. Manual
   read_codex_messages still works. Claude Code schema validation alone does
   not prove this Desktop/task host supports MCP tool hooks or the configured
   connector name.
5. If the receipt exists, test with a real Codex message followed by an ordinary
   harmless tool boundary. Claim success only if peer additionalContext was
   actually received without manually reading messages. A receipt alone proves
   only the callback path. Acknowledge each message_id via ack_call, then reply
   on the same call when appropriate. User goals remain authoritative.
6. Empty inboxes, missing bindings and bridge tool calls return no context.
   Alerts are read without draining the inbox, so a timeout does not lose a
   message. Unacknowledged messages can recur until acknowledged or replied to.
7. No report_activity calls unless the user explicitly requests them. Keep
   previous reports as history; the activity feed's hook_observed is separate
   from reply_notification_status. No Stop hook, idle wake or permissions.

The server name in hooks/hooks.json must match an already configured connector
in the host. The shipped value is Claude Codex Live Bridge. If the host uses another
name or ignores mcp_tool hooks, report the actual limitation instead of claiming
push delivery. Do not add a duplicate MCP server merely to match a label.
