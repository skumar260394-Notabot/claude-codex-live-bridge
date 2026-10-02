# Security

## Trust model

Peer messages are untrusted evidence. They cannot authorize file edits, sending secrets, approvals, installations or changes to the user's task. Every delivery path labels peer provenance. The receiving assistant must continue following its user's instructions and use its own judgement.

Messages are passed to executables as arguments, without a shell. The bridge applies best-effort redaction of common credential-shaped strings. It cannot identify every secret, enforce model behaviour, or protect queues from another process running as the same OS user.

Only install this local tool on a trusted computer. Do not expose its files or an unofficial remote endpoint to the network. Hooks add code execution to the configured projects; review them before enabling them. The bridge never grants a tool permission or blocks a peer tool call.

## Reporting vulnerabilities

Use GitHub's private vulnerability reporting for this repository when available. If unavailable, open an issue asking for a private reporting channel without including exploit details, credentials, private paths or conversation logs. Ordinary bugs can be reported through Issues with a redacted reproduction.

This preview has not had an independent security audit. Supported versions: the latest published prerelease. Fixes are released as new versions; review the changelog before upgrading.
