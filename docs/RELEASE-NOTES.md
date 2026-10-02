# lovestory 0.3.0-beta.1

First public Windows preview of the local Claude ↔ Codex collaboration bridge, MIT licensed.

## Downloads

- `lovestory-desktop-0.3.0-beta.1.mcpb`: install in Claude Desktop's Extensions settings.
- `lovestory-codex-0.3.0-beta.1.zip`: Codex plugin source package; repository marketplace installation is recommended.
- `lovestory-alerts-0.3.0-beta.1.zip`: optional experimental Claude reply-only companion.
- `SHA256SUMS.txt`: checksums for all three packages.

Read [installation](https://github.com/skumar260394-Notabot/lovestory/blob/main/docs/INSTALL.md), [supported features](https://github.com/skumar260394-Notabot/lovestory/blob/main/docs/SUPPORT.md), and [privacy](https://github.com/skumar260394-Notabot/lovestory/blob/main/PRIVACY.md).

Existing private bridge users: public plugin identities are new. Disable/disconnect the previous versions before enabling lovestory; installing this preview does not replace them automatically.

## Verification

The legacy suite, 20 reciprocal checks and 46 reply-only checks passed in isolated environments. All packages passed integrity/checksum checks and both MCP servers started successfully from freshly extracted archives. This verifies the local protocol and package layout, not a live UI installation.

## Known limitations

Silent Desktop raised hands are experimental: native host transport and real pending-message delivery remain unverified. Manual inbox reads remain supported. Idle Claude Desktop wake is not provided. Codex queue acceptance alone does not establish delivery during an active turn. Claude Code idle delivery needs a running development channel and its explicit opt-in. No cross-machine relay is included.

The relay stores data locally, but delivered messages enter Claude/Codex provider conversations. Peer messages are untrusted evidence and cannot authorize actions. No vendor public-directory approval or affiliation is claimed.
