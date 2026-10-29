# 测试用例矩阵

| 编号 | 回归点 / task | 操作与预期 | 状态 |
| --- | --- | --- | --- |
| TC1 | R1 / T1 | 同 ID 并发只发一次，换正文拒绝，同会话顺序执行 | 通过 |
| TC2 | R1 / T1 | sending 重启变 unknown，回执中无正文 | 通过 |
| TC3 | R2 / T1 | 明确未发送才降级，未知不发 B，可凭原生 ID 核对 accepted | 通过 |
| TC4 | R3 / T2 | 实际 Codex app-server 与 CLI queue 返回接受；字面参数不经过 shell | 通过 |
| TC5 | R3 / T3 | 实际 Claude SDK 与 CLI queue，隔离 fake CLI 验证 steer；外部活跃归属拒绝恢复 | 通过 |
| TC6 | R4 / T1–T3 | 未确认打断不发替换消息；已打断后的投递错误保留部分结果 | 通过 |
| TC7 | R3–R4 / T3 | 早期回复 UUID 确认、合并输入同时结束、迟到回显不复活已结束轮次 | 通过 |
| TC8 | R5 / T4 | 实际 HTTP 和 stdio MCP，新增 5 工具、去重、unknown 错误标记、拒绝 executable 字段 | 通过 |
| TC9 | R2–R3 / T3 | Otty 多匹配/等待回答拒绝，文字按原样作为参数传入 | 通过 |
| TC10 | R6 / T5 | 启动失败可降级，已启动写进程超时 unknown，忽略 TERM 时被 KILL 回收 | 通过 |
| TC11 | R6 / T4–T5 | 实际无 node_modules 的包运行 Codex/Claude 两通道；临时 HOME 执行安装脚本与健康/Dashboard/SSE | 通过 |
| TC12 | R7 / T5 | npm test、test:ui、check、package:release 均成功 | 通过 |

专项实现位于 test/session-messaging.test.mjs，共 16 项；原生程序验收使用 /tmp 下独立脚本，不向真实工作会话发送文本。
