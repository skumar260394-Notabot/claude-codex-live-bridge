# Contributing

Use Node.js 18+ and Python 3.9+. There are no npm runtime dependencies.

- `plugins/claude-codex-live-bridge/`: Codex manifests, skill, hooks and canonical shared runtime.
- `claude/desktop-extension/`: Desktop-specific MCP server and package manifest. Four shared module files are development re-exports; the builder replaces them with canonical sources inside the MCPB.
- `claude/alerts/`: experimental reply-only companion.
- `tests/`: additional notification tests, using an isolated temporary home.
- `scripts/`: source checks, isolated test runner and deterministic package builder.

Run `node scripts/check.mjs`, `node scripts/test.mjs` and `python scripts/build.py` before proposing a change. Keep protocol receipts honest, preserve queued messages on failed delivery, and keep selection explicit. Do not add model polling, per-step report reminders or permission decisions to the reply companion.

Tests simulate clients and queues. They do not establish live Desktop hook support. Changes to native hook behaviour require a separate observed probe and model acknowledgement in the intended host.

Include install/update/removal changes in the docs. Do not commit real inboxes, credentials, session IDs, logs or local paths. Follow the MIT license when contributing code.
