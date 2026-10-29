# 测试计划

已逐项对照 01-plan.md 和 02-tasks.md：T1–T5 均完成；实现保留 provider → 有序 transport，未增加第二份会话正文或任务调度。

## 范围与回归点

- R1 投递去重与串行：并发相同 ID、冲突内容、会话级顺序、重启在途状态。
- R2 安全降级：仅明确未发送才能换通道；断线/超时不重发；错误 store 不执行。
- R3 原生能力：Codex app-server/CLI queue；Claude SDK/stream-json CLI 的 queue、steer、stop；拒绝外部活跃归属。
- R4 打断顺序：确认指定轮次被打断后才发送；自然结束或未知结果不能发送替换消息。
- R5 集成：HTTP 字段白名单、真实 stdio MCP、工具列表、结构化错误、查询回执。
- R6 生命周期与发布包：超时进程回收、临时 HOME 清理、无 node_modules 的原生验证、安装后健康/Dashboard/SSE。
- R7 现有行为：后端回归、UI 回归、语法和类型检查；不改变定时任务或生产配置。

## 环境与边界

macOS；源码回归使用 Node 24.21.0，独立发布包另以 Node 26.3.0 验证。使用真实本机 Codex/Claude CLI、隔离数据根和 loopback 假模型，不使用用户账号或真实工作会话。未在 Linux 主机实测本功能，未测试实际 Otty 文本注入；终端匹配与拒绝分支由隔离测试覆盖。无 UI 功能改动，不做浏览器视觉审阅。
