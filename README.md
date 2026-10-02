# Claude Codex Live Bridge

A local conversation bridge between Claude and Codex. Choose an existing chat, send a message, raise a concern while your peer works, and follow supported activity feeds.

**Windows preview — 0.3.0-beta.3.** The original local bridge has been exercised by its owner. Automated tests cover message routing, receipts, hook output, limits and isolation. The new silent Claude Desktop alert companion has **not** passed a live Desktop transport test. Read [supported features](docs/SUPPORT.md) before relying on automatic delivery.

## What it does

- Finds existing Codex chats by name across local projects. A Claude chat does not need a project folder.
- Exchanges messages on selected calls, with separate queue, delivery and acknowledgement receipts.
- Sends nonblocking raised hands to Claude Code at hook boundaries; a running development channel can receive while idle.
- Continues long conversations across linked call segments, with a configurable overall limit (default: 200 turns).
- Offers optional activity feeds and local Git worktree overlap checks.
- Includes an experimental reply-only Desktop companion: no activity-report reminders and no model context when the inbox is empty, if the host supports its direct MCP hooks.

This release is for **two assistants on the same computer**. A shared Git remote does not transport live messages. The bridge does not start replacement chats, stop either assistant, or approve tools.

## Install

Download the matching files from [Releases](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/releases).

1. **Codex:** add this Git marketplace with `codex plugin marketplace add skumar260394-Notabot/claude-codex-live-bridge --ref v0.3.0-beta.3`. Open the local marketplace in the desktop app's Plugins Directory and install **Claude Codex Live Bridge**. Restart or reload the client as needed.
2. **Claude Desktop:** Settings → Extensions → Advanced settings → Install Extension → select `claude-codex-live-bridge-desktop-0.3.0-beta.3.mcpb`.
3. **Claude Code:** ask Codex to connect the intended local project using the bridge tools. See [installation and removal](docs/INSTALL.md).
4. **Optional Desktop alerts:** install `claude-codex-live-bridge-alerts-0.3.0-beta.3.zip` through Claude's plugin upload interface. This feature needs a native probe and real pending-message test; uploading the ZIP alone does not establish support.

Requirements: Windows, Node.js 18 or newer on PATH, the relevant signed-in Claude/Codex clients, and Git for overlap checks. No npm runtime dependencies, separate API keys or hosted relay are required. Normal model usage and account limits still apply.

## First conversation

In Claude, ask: “Use claude-codex-live-bridge to list Codex sessions and find the exact chat named `<your chat title>`. Show the match before opening a greeting-only call. Do not change files.”

Use its exact `thread:<id>` endpoint. In Codex, reply on the same call. In Claude Desktop, use `read_codex_messages` with that call ID. **An actual reply confirms the round trip; queue acceptance alone does not.** Cross-project selection must be deliberate. Routing to a chat does not authorize edits in its project.

## Configuration

Both peers read `~/.codex-claude-live/config.json` on each send:

```json
{ "max_conversation_turns": 200 }
```

Allowed values: integers from 2 to 10000. Segments default to 6 turns, maximum 20; the next reply starts a linked segment until the overall limit is reached. Close finished calls to release one of eight open slots per project.

Codex executable discovery runs on each send. It checks complete Windows app bundles, executable PATH entries and npm vendor binaries. An optional `CODEX_BRIDGE_CLI` override must point at an executable; avoid pinning a version-specific app folder. See [troubleshooting](docs/TROUBLESHOOTING.md).

## Privacy and trust

Local queues and activity files are stored under `~/.codex-claude-live`; this repository does not include them. Messages delivered to Claude or Codex become part of those providers' conversations. “Local relay” does **not** mean conversation data never leaves your machine. [Privacy](PRIVACY.md) describes what is stored and shared.

Peer messages are labeled as evidence, never user authorization. Credential redaction is best effort, not a guarantee. Do not send secrets or expose the local store to untrusted users. Read [security](SECURITY.md).

## Build and verify

```sh
node scripts/check.mjs
node scripts/test.mjs
python scripts/build.py
```

Builds produce a Codex ZIP, Claude MCPB, optional alerts ZIP and SHA-256 checksums in `dist/`. Shared modules have one canonical source in `plugins/claude-codex-live-bridge/bridge/`; the builder embeds them in the Desktop package. [Contributing](CONTRIBUTING.md) and [release notes](CHANGELOG.md) explain the layout.

MIT licensed. Independent project; not affiliated with or endorsed by Anthropic or OpenAI. GitHub distribution does not imply listing or approval in either vendor's public directory.
