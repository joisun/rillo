# 验证用例

| 场景 | 预期 |
| --- | --- |
| 旧服务运行中迁移 | 确认无运行中 Scheduled Run；先停旧服务，再切换数据与新服务 |
| 同时存在旧/新目录、外来服务 | 拒绝覆盖，原数据与服务不动 |
| WAL 数据库、历史 IPC socket | SQLite 一致性备份；IPC 记录元信息，不影响其持有者 |
| 安装中途失败 | 恢复原配置字节、目录、CLI、current 和原服务状态 |
| 历史 Schedule type | 接受旧标记，外部 Markdown 原样；新写入使用 rillo 标记 |
| 浏览器旧偏好 | 迁移到新 key；写入失败保留旧值 |
| 两种 MCP 插件 | server 名 rillo、版本0.15.0、25工具，可读取7个任务 |
| CLI 与本机服务 | rillo --help/--version/status 正确；旧服务卸载，新服务 ready |
| 隔离卸载 | 服务登记移除，用户数据与配置保留 |
| GitHub 仓库更名 | 同一仓库 ID、4分支 SHA、28 Release 和资产元数据不变 |

Linux systemd 与迁移命令路径由测试替身验证；本次未连接真实 Linux/sun。真实 Linux 包验证继续由正式发布 CI 执行。
