---
name: session-relations
description: Register or remove an explicit parent-child delegation between native agent sessions; discover exact provider/store identities for Otty or another terminal launcher.
---

# Session relations

Use `session_sources` to query providers and their exact `store_id`. A SessionRef is `{provider, store_id, session_id}`. For Codex, `session_id` is the native `thread.id`, not an execution ID, agent key, PID, or worktree name.

After a delegated child session has been created and its native ID is known, call `session_link({parent, child, source?})`. `source` describes the launcher, for example `otty`. Preserve the exact provider/store IDs returned by `session_sources`; do not derive or invent them. If the launcher does not expose the native child session ID, leave the relation unregistered until it can be read reliably.

Use `session_unlink({parent, child})` for an explicit correction or removal. Repeating either operation is safe. Native subagent and fork relations come from the provider and are read-only; unlink only removes registered relations. No lifecycle hooks, Task attribution, checkpoint, heartbeat, or automatic summary calls are required. These tools do not create or stop agent sessions.

If the service is unavailable, run `tasks-recorder status` to diagnose it. If `API_VERSION_MISMATCH` is returned, update the service and plugin together. Never write SQLite or create substitute persistence files.
