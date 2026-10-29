# 状态

status: done
current_task: none
branch: feature/session-messaging
worktree: /Users/joi-com/Desktop/space/projects/rillo/.worktree/feature-session-messaging

T1–T6 全部完成。统一 MCP/HTTP 控制入口、Codex/Claude provider、有序 transport、安全降级与持久化幂等回执已实现。新增 5 个 MCP 工具，总数 25。

v0.14.0 发布检查：后端 578、UI 79、语法160文件与类型检查通过；自包含发布包已完成临时 HOME 安装验证。当前会话真实 queue 输入已实际收到并回复同一标记。详情见 06-test-report.md。

功能提交：a77e31f。用户已明确授权提交、发布及本地升级，按 v0.14.0 进行。实际发布状态以 GitHub Release、部署版本以本机 /api/v1/meta 为准。新增 test/session-messaging.test.mjs 按用户默认规则留本地，不进入提交。
