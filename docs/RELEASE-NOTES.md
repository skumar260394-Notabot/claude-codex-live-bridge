# Claude Codex Live Bridge 0.3.0-beta.5

Windows bug-fix preview of the local Claude ↔ Codex collaboration bridge, MIT licensed.

## Downloads

- `claude-codex-live-bridge-desktop-0.3.0-beta.5.mcpb`: install in Claude Desktop's Extensions settings.
- `claude-codex-live-bridge-codex-0.3.0-beta.5.zip`: Codex plugin source package; repository marketplace installation is recommended.
- `claude-codex-live-bridge-alerts-0.3.0-beta.5.zip`: optional experimental Claude reply-only companion.
- `SHA256SUMS.txt`: checksums for all three packages.

Read [installation](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/docs/INSTALL.md), [supported features](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/docs/SUPPORT.md), and [privacy](https://github.com/skumar260394-Notabot/claude-codex-live-bridge/blob/main/PRIVACY.md).

Existing private bridge users: public plugin identities are new. Disable/disconnect the previous versions before enabling claude-codex-live-bridge; installing this preview does not replace them automatically.

## Fixed in this release

Named Codex lookup now discovers compatible numbered SQLite databases and
optional title/name columns, exposes failures, and excludes stale deleted
chats. Node.js 22.13.0+ is required. The alert probe works in Windows shells.
Both Codex manifests explicitly register hooks. Queue support is probed before
advertising availability. Generated machine settings use local Git exclusions;
tracked files are preserved with an actionable refusal. Desktop companion and
Claude Code channel server names are documented separately. The stale cache
path repair from beta.3 remains covered by its regression suite.

After updating the Codex plugin, run `connect_project` for each existing Claude
Code project, then reload the affected Claude Code session as needed. Desktop
users do not need Claude Code installation or its CLI login. There is no
cloud-session connector change in this release.

## Verification

The legacy suite, 20 reciprocal checks, six setup-upgrade checks, 46 reply-only
checks and 17 local-review regressions passed in isolated environments. All
packages passed integrity/checksum checks and both MCP servers started from
freshly extracted archives. This verifies local behavior and package layout;
native Claude alert delivery remains unverified.

## Known limitations

Silent Desktop raised hands are experimental: native host transport and real pending-message delivery remain unverified. Manual inbox reads remain supported. Idle Claude Desktop wake is not provided. Codex queue acceptance alone does not establish delivery during an active turn. Claude Code idle delivery needs a running development channel and its explicit opt-in. No cross-machine relay is included.

The relay stores data locally, but delivered messages enter Claude/Codex provider conversations. Peer messages are untrusted evidence and cannot authorize actions. No vendor public-directory approval or affiliation is claimed.
