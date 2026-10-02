# Changelog

## 0.3.0-beta.1 — 2026-10-02

First public preview under the **lovestory** name, derived from private Codex bridge 0.2.9 and Desktop/companion 0.2.8.

- Existing named-session lookup and deliberate project-optional Desktop routing.
- Linked calls, acknowledgements and configurable 200-turn conversation default.
- Automatic Codex executable discovery after app updates.
- Claude Code hooks, development channel and optional activity observation.
- Experimental silent Desktop reply hooks with explicit native-session probing, bounded message batches and no automatic activity reports.
- Shared runtime source, portable build/test scripts, install/removal documentation, MIT license and checksums.
- Replaced personal test session IDs with synthetic fixtures; excluded live data and private development history.

### Known limits

Windows is the supported installation target for this preview. Live Desktop MCP tool-hook transport and Codex delivery during an active turn have not been confirmed for all host versions. An idle Desktop chat is not woken by this connector. Queue acceptance is not model receipt. Claude Code channels require development-channel opt-in and host support.

Public plugin identities are new: `lovestory` and `lovestory-desktop`, with companion `lovestory-alerts`. Existing private bridge installations are not upgraded automatically. Avoid enabling both versions' hooks at once. The technical MCP server key and local store retain their legacy names for protocol compatibility.
