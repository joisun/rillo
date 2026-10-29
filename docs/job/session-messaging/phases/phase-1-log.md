
## 实现与第一轮验证

- 已落实统一契约、持久化回执、按会话串行和 provider 的多通道降级。未提交。
- 10 项隔离测试通过。SDK 必须传原生 claude_code preset，避免空 systemPrompt；fake CLI 修正为识别 SDK 的 --resume=UUID 形式，已对照官方发布包源码确认。
- 新版 Claude 官方会话文档明确 piped --resume 不能向现有 background session 注入，所以必须先核对 agent 目录、拒绝并发 worker，必要时再用终端队列。
- 原生 Codex 队列可在入队后立即消费，入队回执与队列成员列表不是同一件事；核对 unknown 时未发现队列成员也不会据此判失败。Unix socket 临时路径已按 Node 官方 IPC 路径限制缩短。


## 完成验收

- 补充 16 项专项测试，总后端 577、UI 79、语法160文件与类型检查通过。
- 查询 Context7 的 Claude 官方 Agent SDK 文档，并对照 SDK 0.3.312 发布包类型；原生用户 replay 可延迟，改用 includePartialMessages 下准确的 user_message_uuid/user_message_uuids 确认输入，迟到重复回显不复活轮次，合并输入随同一结果结束。
- 真实 Codex app-server 和 CLI queue 均接受；真实 Claude SDK/stream-json CLI 通过 queue 和指定轮次 stop，观察到 terminal_reason=aborted_streaming。全部使用隔离 HOME/配置与 loopback 假模型。
- 完整包解到 /tmp 后没有 node_modules，重复原生四通道检查通过；执行发布 install.sh 到临时 HOME，版本/Dashboard/SSE 通过。临时进程组与 HOME 最终清理。
- 补充超时 TERM→KILL 回收验证。数据根与生产服务未改动。
- 未提交：本次仅获推进实现授权，无提交或发布授权。


## 用户授权真实自发消息测试

- 本次用户明确要求给当前会话发一条消息。通过新构建 adapter 的 stdio MCP → 临时 HTTP API → SessionMessaging → Codex app-server，调用 session_send(mode=queue) 一次。
- 目标 01a151d3-e8d2-7ed0-a65b-6e4c2e129bbb 来自当前 CODEX_THREAD_ID。request_id=selftest-20261029-1793262759659，native_message_id=01a186ca-2f67-7b23-a6ff-001ce3ebbbff。回执 accepted，原生 queue/list 查到同一 ID。临时 API、MCP、回执库清理，真实 Codex 服务继续运行；未重复发送。
- 实测发现 thread/turns/list 的 itemsView=minimal 不受 Codex 0.165.0 支持，原生错误明确列出 notLoaded/summary/full。改为 summary 后实际当前会话返回 inProgress 轮次，provider.describe 的 native_available=true。前一轮隔离假协议未校验该枚举，已补精确参数及 guard/stop 的回归测试。
- 消息仍排队时只声明入队成功；实际模型收到须由后续会话回复确认，不将 accepted 冒称 delivered。

- 当前会话已实际收到 selftest-20261029-1793262759659 并回复确认，真实端到端验证闭环；T6 后端 578/578。用户已授权最终提交、发布及本地升级，新增测试按默认规则不提交。

## v0.14.0 发布准备

- 功能提交 a77e31f，新增测试按用户默认规则保留本地。统一 service、MCP、Codex/Claude manifests 与 marketplace 为 0.14.0。
- 新版本重新构建与验证：578 后端、79 UI、语法/类型通过。发布由 tag 工作流执行，macOS 构建、Ubuntu 安装验收通过后公开 GitHub Release，再安装本地。
