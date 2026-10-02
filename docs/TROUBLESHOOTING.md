# Troubleshooting

| Symptom | Check |
| --- | --- |
| Extension appears as a chat attachment | Install through Settings → Extensions, not the conversation's file attachment button. |
| Codex updated and wake fails | Inspect executable discovery in bridge status. Remove an obsolete `CODEX_BRIDGE_CLI` override or set a valid executable. Normal discovery avoids version-pinned folders. |
| Message is queued but unseen | Check the exact target endpoint, host state and actual acknowledgement. Queue acceptance is not proof of model visibility. |
| No Codex hook observed | Verify hooks were trusted/loaded and both peers use the same project root. A plugin's cached working directory is not necessarily the shared project. |
| Wrong project | Choose the exact existing Codex chat by name and its endpoint. Use `project_path` deliberately; never infer it from a title. |
| Claude Desktop reply does not appear | Read the call with `read_codex_messages`. Idle Desktop wake is not provided. |
| Silent companion probe stays false | The host may not support direct MCP hooks or may use a different connector name. Do not manually call `reply_hook`; keep manual reads and report the host/version. |
| Hook observed but no message seen | A probe only proves callback invocation. Test a real queued message and acknowledgement on the selected call. |
| Desktop message repeats | Acknowledge each message ID or read/reply on the call. The hook deliberately peeks so a timeout cannot lose messages. |
| Unexpected per-step reminders/reports | Disable the old activity companion. The public reply companion produces neither. |
| Call budget reached | Edit `max_conversation_turns` in the local config, within 2–10000. Close finished calls; open a new topic when appropriate. |
| Activity feed is old | Check event source and timestamps. Silence does not establish whether the peer is working or idle. |

Bug reports should include version numbers, a redacted status result and a minimal reproduction. Do not attach the local inbox, full conversations, credentials or private project logs.
