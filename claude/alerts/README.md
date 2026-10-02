# lovestory Alerts 0.3.0-beta.1

Public companion identity: lovestory-alerts. Activity and
per-step polling reminders are removed. Install the companion ZIP through
Customize > Plugins, and the matching lovestory 0.3.0-beta.1 MCPB through
Settings > Extensions > Advanced settings > Install Extension.

## Delivery

On hosts that support an MCP tool hook targeting the existing Desktop connector,
the callback checks only explicitly bound calls and returns additionalContext
only for pending Codex messages. Empty means no text. It performs no model call,
timer, activity collection, or recurring report. Message reading and responding
still use Claude tokens; do not claim zero total overhead or idle wake.

Use the share-activity skill to prepare a selected existing open call, run its
unique harmless probe command, and inspect reply_notification_status. Binding
uses the observed native session, not a guessed newest chat or a declared
activity ID. The probe is silent: its receipt is inspected explicitly.

The direct MCP hook route is documented for Claude Code, but is NOT established
for the intended Desktop/task chat. It requires a live setup probe and a real
message context test. If the host ignores this hook type or cannot resolve the
connector, it cannot alert Claude; manual read_codex_messages remains available.
This package does not quietly substitute model polling. It does not deploy a
public relay or expose the local inbox.

Only 4 pending messages per callback are included. They remain queued until
acknowledgement, reply, or manual inbox reading. Returning hook context is not
proof of model receipt. A timed-out hook therefore cannot lose a queued message.
Call ownership is exclusive and linked continuations use the same binding.

Existing activity history remains; its hook_observed flag is not changed by
reply-only probes. The retired activity-reminder.py is silent and unused.

Reference: https://code.claude.com/docs/en/hooks#mcp-tool-hook-fields
