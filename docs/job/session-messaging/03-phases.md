# 状态

status: done
current_task: none
branch: feature/session-messaging
worktree: /Users/joi-com/Desktop/space/projects/tasks-recorder/.worktree/feature-session-messaging

T1–T5 全部完成。实现统一 MCP/HTTP 控制入口、Codex/Claude provider、有序 transport、安全降级与持久化幂等回执。新增 5 个 MCP 工具，总数 25。

验收：后端 578、UI 79、语法160文件与类型检查全部通过；无 node_modules 的独立发布包通过真实 Codex app-server/CLI queue、Claude SDK/CLI queue+stop 和临时 HOME 安装检查。结果与边界见 06-test-report.md。

未提交、未发布、未安装；正式 v0.13.0 未改动。测试进程、隔离 HOME/数据源均已清理；/tmp 下验收日志和临时构建产物保留供复核。

补充 T6：用户授权给当前会话发送一次 queue 测试，原生 accepted 且 queue/list 匹配；已在当前会话实际收到并回复相同标记。实测修正 Codex turns/list itemsView=summary，当前原生能力与轮次读取通过。新增回归用例，详细结果见报告与日志。

发布授权：用户已明确要求提交、发布、更新本地。准备 v0.14.0；新增 test/session-messaging.test.mjs 按用户默认规则留本地，不进入提交。
