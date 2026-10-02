# Release verification — 0.3.0-beta.2

## Checked locally on Windows

- Source checks: JSON/manifests, JavaScript syntax, personal path and credential patterns.
- Legacy hook/setup suite passed.
- Reciprocal MCP/channel/protocol suite: 20 checks passed with a recording CLI stub.
- Reply-only notifications: 46 checks passed with isolated homes and synthetic sessions.
- Three built archives passed integrity and SHA-256 verification.
- Freshly extracted Codex and Desktop packages initialized and listed tools through real MCP subprocesses. They did not launch or contact real assistant sessions.
- Shared module bytes in the Desktop archive match the canonical runtime source.
- Git history starts from the sanitized public source; private development history and runtime state are excluded.

## Still requires live host verification

- Installing the public identities through each app's UI.
- Native Desktop direct MCP hook support, correct connector name, and actual model-visible pending-message acknowledgement.
- Codex delivery during an active turn without user steering on each supported host version.
- macOS/Linux client installation; Windows is the preview target.

Automated simulation and fresh MCP startup do not replace these live checks. This is a prerelease so users can test and report host compatibility.
