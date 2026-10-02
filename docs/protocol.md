# Protocol and routing

A call correlates a selected Codex endpoint and Claude endpoint. Messages are numbered turns. Full segments continue with the same topic and endpoints until the configured overall limit is reached.

| Guard | Default / limit |
| --- | --- |
| Segment turns | 6 / 20 maximum |
| Overall conversation turns | 200 / configurable 2–10000 |
| Turn interval | One per second per conversation |
| Open calls | Eight per project |
| Message body | 4000 characters, truncated |

`queued` means accepted by transport. `delivered_at` means claimed by a channel/hook or confirmed by a peer acknowledgement/reply; queue-command success alone does not set it. `acked_at` means explicit acknowledgement. Keep these states separate in user-facing status.

Desktop routing selects an existing `thread:<id>` from `codex_sessions`; the selected Codex chat determines the local project store. Optional `project_path` verifies or filters it. Never guess the newest chat. Claude Code uses an explicitly selected `session:<id>` or a verified running `channel:<id>`. Session names do not establish channel identity.

Reply-only hooks peek at up to four messages in explicitly bound calls, following linked segments. They do not drain the inbox. A lost callback result can therefore be retried. Acknowledge each `message_id` to stop repetition. The setup probe binds the native session, separate from declared activity metadata. Empty output has no model reminder text.

The local store retains its historical `.codex-claude-live` directory and the Codex-side MCP key `claude-live-bridge`. These technical names allow existing protocol consumers to interoperate; the public plugin is lovestory. Avoid simultaneously enabling private and public hook installations.

See [supported features](SUPPORT.md), [installation](INSTALL.md), and [privacy](../PRIVACY.md). This preview has no cross-machine relay or idle Desktop wake.
