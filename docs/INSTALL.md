# Install, update and remove

## Prerequisites

Windows, Node.js 22.13.0+ on PATH, an installed local Codex client, and Claude Desktop and/or Claude Code. Sign into the clients using your normal account. Git is needed for project setup and overlap checks. Python 3.9+ is a build prerequisite, not a runtime requirement for the bridge. Use matching release assets.

**Desktop-only use does not require Claude Code or a Claude CLI login.** The
Desktop extension connects through the signed-in Claude app. Claude Code and
its Remote Control sessions require their own Claude Code login; signing into
the Desktop app does not establish that login.

## Codex

Setup writes per-machine project settings. In a Git repository it adds exact
paths to the local `.git/info/exclude`, preserving the shared `.gitignore`.
It refuses to modify a tracked `.mcp.json`, `.codex/hooks.json`, or
`.claude/settings.local.json`. Keep tracked configuration portable; for a
tracked Claude MCP config, Claude Code's `--scope local` stores that server in
your user configuration instead. The bridge does not untrack files for you.

The optional alert companion targets the Desktop connector named
`Claude Codex Live Bridge`. It is not a Claude Code channel plugin: that
channel uses `claude-live-bridge` and its own live transport. Do not enable
Desktop companion hooks globally in Claude Code or rename their server to
match the channel. A missing connector must be reported, never treated as
successful notification delivery.

Add the repository marketplace:

```sh
codex plugin marketplace add skumar260394-Notabot/claude-codex-live-bridge --ref v0.3.0-beta.5
```

Install **Claude Codex Live Bridge** from that local source in the desktop Plugins Directory. Alternatively, clone the repository and add its local directory as a marketplace. Review and trust hooks using your client's hook controls (`/hooks` where available); restart/reload the session if required. No hook is proven active until a real event is observed.

The internal MCP server key is `claude-live-bridge`, retained for protocol compatibility. The public plugin/display name is claude-codex-live-bridge. Do not install a duplicate server to fix a naming error.

## Claude Desktop

Download `claude-codex-live-bridge-desktop-0.3.0-beta.5.mcpb`. Use Settings → Extensions → Advanced settings → Install Extension. Select the MCPB; do not attach it to a conversation as a document. Enable claude-codex-live-bridge in the conversation's connector menu. Restart Claude if the app requests it or fails to load the server.

Ask Claude to list Codex chats with `codex_sessions`, choose the exact intended `thread:<id>`, and open a greeting-only `call_codex`. An optional absolute `project_path` verifies or filters the destination. No folder is guessed from a chat title. Read replies using `read_codex_messages` and the returned call ID.

### Optional experimental raised hands

Upload `claude-codex-live-bridge-alerts-0.3.0-beta.5.zip` through Claude's plugin installation interface, then enable it. The host must support a direct `mcp_tool` hook into the already configured Desktop connector. The shipped server name `Claude Codex Live Bridge` must match the host's actual configured connector name. This transport is documented for Claude Code; Desktop/task-host support is unverified.

In the exact existing Claude chat, use `prepare_reply_notifications` for an explicitly selected open call. If a legacy activity subscription owns that call, supply its same `activity_session_id`. Run the returned harmless `probe_command` as an ordinary command in that chat, then inspect `reply_notification_status`. Do **not** call `reply_hook` from the model or fabricate a hook receipt. Renew an expired unbound probe with `retry_probe: true`.

Then send a single greeting from Codex and have Claude perform an ordinary supported step. Confirm that the hook's peer message appears and Claude acknowledges its `message_id` and replies on the call. Silence when empty, correct session selection and actual receipt are separate checks. If the host rejects the hook type or cannot resolve the server, disable the companion and use manual reads. Do not substitute token-consuming reminder hooks or a polling timer.

## Claude Code

In Codex, use `connect_project` with the intended absolute folder. It preserves other Claude settings and registers the development channel in the project's `.mcp.json`. Use `connect_codex_project` with the **same root** for reciprocal hooks. Review/trust and reload hooks as required.

Start Claude Code in that project with the registered channel:

```sh
claude --dangerously-load-development-channels server:claude-live-bridge
```

This is an explicit development-channel opt-in. Read the host's warning; the project is not an Anthropic-allowlisted channel. The bridge does not bypass other permissions. Availability and syntax can change with host versions.

Use `list_sessions` to choose the exact existing Claude session endpoint. A session receives at a hook boundary; a verified running channel can receive while idle. Do not assume the newest channel belongs to the desired named session. Check `bridge_status` and real acknowledgements.

## Updating from private versions

The public identities are new, so installing claude-codex-live-bridge does not replace the privately created Claude Live Bridge or Codex Live Bridge extension. Close old calls, disconnect old project hooks using that version's tools, and disable/remove the old extension and companion through their clients. Then install claude-codex-live-bridge. Never run both sets of hooks on the same project. Local history remains under the legacy `.codex-claude-live` directory; clear it yourself if you want a fresh start.

For future claude-codex-live-bridge releases, replace the MCPB and companion with matching assets, refresh the Codex marketplace, and reload clients as needed. A pinned Git ref must be updated deliberately.

For each project already connected to **Claude Code**, run `connect_project`
again after updating the Codex plugin. This refreshes managed script paths if
the plugin moved, including paths into an old version cache. It preserves
other hooks, servers, permissions and custom options. Then reload the affected
Claude Code session as required. `hooks_updated` reports refreshed hooks;
`bridge_status.setup.claude_paths` identifies missing scripts and incomplete
events. Configured, usable, loaded and live are separate states. Desktop-only
users do not need this project hook setup.

## Removal

Disconnect project hooks/channel with `disconnect_project`, `disconnect_codex_project` and `disconnect_claude_channel` where applicable. These remove only bridge-managed entries. Disable selected reply bindings with `disable_reply_notifications`. Remove the Desktop extension and companion using Claude settings, and claude-codex-live-bridge using Codex plugin controls. Remove the marketplace with `codex plugin marketplace remove claude-codex-live-bridge` if desired. History is retained; see [Privacy](../PRIVACY.md) for deleting it.

## Primary references

- [Codex local plugin packaging and marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [Claude local MCP servers and extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
