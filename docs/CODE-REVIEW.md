# Local review resolution — 0.3.0-beta.4

The seven questions from the owner's Claude review were checked against source,
installed-client help and the vendors' current documentation.

| Finding | Resolution |
| --- | --- |
| Old installed cache paths survive an update | Fixed in beta.3; reconnect refreshes owned hooks/channel paths and preserves other settings. Upgrade regressions remain in the suite. |
| Hard-coded SQLite version and Node 18 claim | Fixed: discover descending numbered state databases, inspect available columns, require id/cwd/archived, support optional name/title/time, expose failures. Node 22.13.0+ is now required. A current database wins over stale index entries and hook logs. |
| Manifest format and missing hook reference | Both manifest formats are supported. Root OpenAI extensions replace the compatibility overlay. Explicit `./hooks/hooks.json` is now declared in both; the previous default discovery was valid. Portable MCP launch paths retain `${PLUGIN_ROOT}`. |
| Different server names | Intentional: Codex and Claude Code use `claude-live-bridge`; the Desktop companion targets `Claude Codex Live Bridge`. Documented host scope; Desktop hook resolution still needs a native test. |
| POSIX-only probe | Fixed: the returned Node command works in PowerShell, cmd and POSIX shells with the required runtime installed. Automated tests execute the command without a model session. |
| Availability of `codex queue` | Confirmed in the installed desktop client's help. The bridge now probes support before advertising availability or attempting a send; unsupported clients leave inbox messages pending. Queue acceptance still does not prove model visibility. |
| Machine paths in project configs | Fixed: generated files receive exact local Git exclusions, including nested workspace paths. Setup refuses tracked files and never untracks them or changes shared ignore rules. |

References: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins),
[Node SQLite](https://nodejs.org/docs/latest-v22.x/api/sqlite.html), and
[Claude Code MCP scopes](https://code.claude.com/docs/en/mcp#local-scope).

This local review does not establish cloud connector visibility, automatic
Codex return delivery, or native Desktop reply-hook support. Those need their
separate host tests. No live Claude messages were sent for these checks.
