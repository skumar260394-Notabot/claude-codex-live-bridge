# Privacy

lovestory has no hosted relay, analytics or tracking service. It uses local files and the installed clients' supported interfaces.

## Data stored locally

The per-user `~/.codex-claude-live` directory contains project hashes, session metadata, message bodies, delivery/acknowledgement receipts, configuration and optional activity history. Project hooks can record tool names, summarized arguments and final messages. This material can include paths and proprietary project information. Declared Desktop activity is recorded only when its tools are called; the reply-only companion does not automatically publish work reports.

Reply notification setup stores a selected call, project root and optional activity owner, plus a native-session probe receipt with session ID, event name and timestamp. Ordinary hook tool input is inspected for the setup marker but is not forwarded as an activity report by this companion.

## Data sent to providers

When peers send or retrieve messages, the message and selected context enter Claude/Codex conversations and are processed under those providers' terms and account settings. Codex wake-up submits a capped message through the installed Codex CLI. Claude Code channels carry messages to the selected running client. The bridge cannot prevent either model from including peer context in its later work.

## Controls and retention

Activity collection can be disconnected using the bridge's project disconnect tools. Use `disable_reply_notifications` to disable a selected Desktop binding; disabling does not delete pending messages. Remove the Desktop extension or companion using Claude's settings, and remove lovestory using Codex's plugin controls. These actions preserve local history.

There is no automatic retention expiry in this preview. After stopping the bridge clients, you can delete the local `.codex-claude-live` directory yourself to erase its history and configuration. Do not upload it when reporting a bug. Share minimal redacted examples instead.
