# Claude Codex Live Bridge 0.3.0-beta.2

Renamed public Windows preview of the local Claude ↔ Codex collaboration bridge, MIT licensed.

## Downloads

- `claude-codex-live-bridge-desktop-0.3.0-beta.2.mcpb`: install in Claude Desktop's Extensions settings.
- `claude-codex-live-bridge-codex-0.3.0-beta.2.zip`: Codex plugin source package; repository marketplace installation is recommended.
- `claude-codex-live-bridge-alerts-0.3.0-beta.2.zip`: optional experimental Claude reply-only companion.
- `SHA256SUMS.txt`: checksums for all three packages.

Read [installation](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/docs/INSTALL.md), [supported features](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/docs/SUPPORT.md), and [privacy](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/PRIVACY.md).

Existing private bridge users: public plugin identities are new. Disable/disconnect the previous versions before enabling claude-codex-live-bridge; installing this preview does not replace them automatically.

## Rename

This release supersedes the lovestory-branded beta.1. Remove/disable those packages before enabling the renamed plugin, Desktop extension and companion. The repository was renamed; GitHub redirects the original links.

## Verification

The legacy suite, 20 reciprocal checks and 46 reply-only checks passed in isolated environments. All packages passed integrity/checksum checks and both MCP servers started successfully from freshly extracted archives. This verifies the local protocol and package layout, not a live UI installation.

## Known limitations

Silent Desktop raised hands are experimental: native host transport and real pending-message delivery remain unverified. Manual inbox reads remain supported. Idle Claude Desktop wake is not provided. Codex queue acceptance alone does not establish delivery during an active turn. Claude Code idle delivery needs a running development channel and its explicit opt-in. No cross-machine relay is included.

The relay stores data locally, but delivered messages enter Claude/Codex provider conversations. Peer messages are untrusted evidence and cannot authorize actions. No vendor public-directory approval or affiliation is claimed.
