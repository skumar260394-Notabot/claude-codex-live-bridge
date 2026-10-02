# Supported features and evidence

| Feature | Current status |
| --- | --- |
| Desktop → selected existing Codex chat → Desktop reply | A real round trip was observed in the private predecessor; fresh public-package installation needs verification on each host. |
| Codex/Claude Code hooks and channel protocol | Automated subprocess/MCP checks pass; a local Claude Code raised hand was observed in the predecessor. |
| Claude Code idle notification | Requires a running development channel; a named session endpoint alone does not prove its channel identity. |
| Codex idle wake | Uses the installed `codex queue` command; actual acknowledgement or reply proves receipt. |
| Codex active-turn context | Requires loaded, trusted hooks using the same project root; queue success alone does not prove mid-turn visibility. |
| Desktop manual inbox reads | Supported connector tools; replies are fetched by call ID. |
| Desktop silent reply-only hooks | **Experimental.** Local tests pass; native Desktop transport and model-visible pending-message delivery remain unverified. |
| Desktop fully idle wake | Not provided by this connector. |
| Desktop activity | Explicit reports or supported direct activity hooks; never inferred from a quiet feed. Reporting can use model tokens. |
| Cross-project chats | Deliberate existing Codex endpoint selection; choosing a target does not authorize edits there. |
| Cross-machine/cloud relay | Not supported; Git does not carry live messages. |
| OS coverage | Windows installation target. Protocol tests can run on other OSes; this does not establish macOS/Linux app integration. |

Receipt meanings: `queued` means accepted into local transport, `delivered_at` means a hook/channel claim or peer acknowledgement/reply, and `acked_at` means explicit acknowledgement. A hook probe receipt proves callback execution, not model receipt of a later message.

This GitHub release is independent of the vendors' public directories. No public-directory review or approval is claimed.
