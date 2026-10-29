# 验收报告

日期：2026-10-29。本机版本0.15.0来自本地构建包，尚未公开发布。

## 自动检查

- Backend：571/571通过；其中安装迁移9个用例覆盖备份、冲突、回滚、Linux服务状态、WAL和IPC。
- UI：82/82通过；syntax161文件与TypeScript检查通过。
- Service/UI及Codex/Claude adapter构建通过，四个rillo资产打包完成。
- 真实install.sh隔离新装通过，服务版本、Dashboard、SSE正常；包内无AppleDouble元数据。
- 原正式0.14.0运行文件在独立HOME升级通过，2个任务/1启用及Run、关系、消息回执保持一致；注入安装故障后恢复原配置和命令。
- 隔离CLI卸载通过，移除服务登记并保留配置和数据；使用launchctl替身，不触及当前服务。

## 本机结果

- `rillo` CLI、`com.joi.rillo.daemon`、`~/.config/rillo`、`~/.local/share/rillo`和`~/Library/Logs/rillo`实际生效，旧服务已卸载。
- health/meta返回rillo、0.15.0、API v5。真实浏览器标题Rillo，Scheduled页面可用。
- Codex和Claude原生登记为`rillo@rillo`。两份已安装MCP均完成握手、25工具发现和只读查询。Codex原生app-server从隔离配置加载插件也发现25工具，未发起模型请求。
- 原233条Run逐行哈希不变，另有准备期正常调度成功的1条记录保留，总234条；其余数据库表一致。
- 7个Schedule、2个enabled，ID/enabled/etag一致；187份原Markdown字节哈希一致。
- 根目录改为rillo，34个worktree完成repair；其他worktree原有status/diff不变。旧根路径仅保留过渡软链接。
- dotfiles只修改相关配置和说明，未提交其既存改动；配置均可解析。

安装备份阶段曾因WAL清理竞态与历史socket失败，均已回滚。改用SQLite一致性备份、等待服务退出和记录IPC元信息后复验并成功切换。初次Codex原生宿主隔离测试漏建Rillo配置，补齐后原插件配置通过，无产品路径改动。

## 远端与边界

- 用户补充授权后实际将仓库更名为`joisun/rillo`，仓库ID `1332808132`不变；origin已更新。
- 4个远端分支SHA、28个Release的ID/tag和资产ID/名称/大小/digest前后一致。未覆盖历史资产、重写Git历史。
- 本次源码未推送，未创建tag或Release，未操作sun。当前公开latest仍属于历史版本。
- 本次没有在真实Linux机器执行安装迁移；Linux服务行为由现有单元测试验证。

旧标识残留均属于迁移识别/兼容测试/迁移说明；详细原因见[更名迁移说明](../../migrations/rillo-rename.md)。备份及原生会话、旧版本、其他开发分支保持其历史内容。

本机原始证据位于`~/.local/state/rillo-migrations/operator-1793267687`；测试与安装日志位于`/tmp/rillo-*`，不含入库的用户数据。
