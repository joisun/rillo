# 实施计划

沿用已确认的 provider/transport 分层，由当前 agent 执行；无需额外阶段提交。

1. 统一控制契约、回执 ledger、会话级串行与安全降级。持久化幂等键和投递状态，重启后的在途请求保守标记 unknown。
2. Codex：已有共享 app-server 定位原会话，队列/追加/打断；CLI queue 仅用于明确未接收后的降级。
3. Claude：验证现有会话身份与运行归属，SDK 与 CLI 通道共用准确 SessionRef。任意外部活跃会话不可凭 resume 另起并发 worker；终端精确匹配后才发送。
4. 接入 HTTP/MCP、正常关闭资源、打包及文档。使用隔离协议服务和临时数据根验证，不触碰生产会话。

全局约束：会话根与 store_id 必须匹配；每条操作有稳定请求 ID；unknown 不自动降级；打断后发送必须先确认被打断的是指定 turn；明确报告不支持，不伪称已送达或已完成。CLI 用参数数组调用，不经 shell。
