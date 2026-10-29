# 会话消息控制

用户已确认：统一 MCP 能力接口；Codex/Claude 各自 adapter；各操作内部有按优先级排列的实现与自动降级。2026-10-29 用户回复“推进”，作为本次范围及实施授权。

范围：排队、追加、打断、打断后发送、能力发现与发送回执；Codex 原生 app-server 优先、CLI queue 次之；Claude SDK/CLI 及可用终端通道。只有明确未接受才能降级；超时或断线结果未知时先核对，不盲目重发。

不在本期：修改现有会话权限、向用户的工作会话试发、重建对话存储、自动发布或提交。终端通道仅在能精确匹配会话且现有 IPC 权限允许时使用。

证据：本机 Codex 0.165.0 导出包含 thread/queue/add/list/update/delete/reorder/start，队列写协议需 experimentalApi。Claude 2.1.292 的 piped --resume 不会给正在运行的 background session 发消息；不能将此视为可接管现有进程。
