# 测试报告

日期：2026-10-29。范围：[测试计划](04-test-plan.md)。

## 结果

[用例矩阵](05-test-cases.md) TC1–TC12 全部通过，P0 投递、错误归属与不重复发送约束均通过。

| 检查 | 结果 / 证据 |
| --- | --- |
| 后端 | 577/577，含本次 16 项；/tmp/tasks-recorder-messaging-full-tests.txt |
| UI | 79/79；/tmp/tasks-recorder-messaging-ui-tests.txt |
| 语法 / 类型 | 160 个源码文件、tsc 通过；/tmp/tasks-recorder-messaging-check.txt |
| 打包 | 四个服务/adapter 包成功；/tmp/tasks-recorder-messaging-package.txt |
| 包内实际 Codex | app-server queue 与 CLI queue 均 accepted；/tmp/tasks-recorder-packaged-codex.txt |
| 包内实际 Claude | SDK、CLI 的 queue 与 stop 均 accepted；/tmp/tasks-recorder-packaged-claude.txt |
| 临时 HOME 安装 | install.sh 安装、版本、Dashboard、SSE 检查通过；独立包运行不依赖 node_modules |
| 文档 | 枚举 167 份 Markdown，核对 README、architecture 和活跃说明，更新新增 API/工具/降级/回执/限制；历史任务记录未重写 |

## 修正与限制

真实 Claude 验证曾发现用户回显延迟：原生已处理输入但尚无 replay。对照官方 SDK 类型的 user_message_uuid/user_message_uuids 与 includePartialMessages，改为同一输入 UUID 的回复流帧或回显作为接受证据，真实两通道复验通过。打断只接受 aborted_streaming/aborted_tools 证据；普通结束不发替换消息。队列可在入队后马上消费，缺席不是未接受的证明。

Codex 连接既有共享服务；不启动另一个服务冒充活跃归属。Claude 原生 `agents --json` 帮助明确包含 interactive/background；未知目录或目标已活跃时不另起 worker。steer/stop 仅控制服务持有的 Claude worker；不承诺任意外部活跃 CLI 的远程控制。Otty 仅 queue，未做实际注入。Claude 长时间排队或旧 CLI 缺少对应 UUID 证据时可先为 unknown，后续仅凭正面证据确认，不重发。

没有剩余失败用例或未处理实现遗漏。Linux 未实测、外部会话控制及终端真实注入是已声明边界，不冒称已验证。源码与文档在 feature/session-messaging worktree；未提交、发布、安装或改动生产服务。官方及本机正式版本仍为 v0.13.0。


## 补充：真实当前会话

用户追加授权自发测试后执行 T6。实际新 MCP 调用 accepted，Codex 原生队列匹配同一 native ID；尚未把排队状态宣称为模型已收到。修正实测暴露的 itemsView=minimal→summary，当前真实轮次查询和能力读取已通过。新增精确参数及 stale guard/steer/stop 回归。原始隔离测试记录保留，未重写为已完成真实会话验收。


## 当前会话消费确认

测试消息 selftest-20261029-1793262759659 已作为当前会话的真实输入到达，并已回复相同标记。T6 后完整后端回归 578/578 通过。用户随后授权提交、发布和本地升级；新增测试文件按仓库规则仅保留本地。
