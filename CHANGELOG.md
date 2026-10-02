# Changelog

## 0.3.0-beta.3 — 2026-10-02

- Reconnecting a Claude Code project refreshes old managed hook and channel
  script paths, preserving other hooks, servers, permissions and custom options.
- Status distinguishes saved entries from usable scripts, reports missing
  lifecycle events/files and offers the repair step. Saved configuration alone
  does not establish a live channel or loaded hook.
- A conflicting third-party server is preserved and connection setup reports
  the failure instead of claiming success.
- Added six isolated upgrade regression checks and clarified that Desktop-only
  use requires neither Claude Code installation nor its CLI login.
- After updating, Claude Code users should run `connect_project` for existing
  connected projects and reload their session as needed. No cloud-session
  connector change is included in this release.

## 0.3.0-beta.2 — 2026-10-02

Renamed the public project to **Claude Codex Live Bridge** at the owner's request. Repository and current installation links use `claude-codex-live-bridge`. Matching Codex, Desktop and alert companion packages have the new identity. Protocol storage and the internal Codex MCP key are preserved.

If beta.1 was installed, disable/remove its lovestory packages before enabling the renamed packages. Historical beta.1 remains available; install beta.2 for the current name.

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
