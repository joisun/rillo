# 执行记录

- 已读取全局规则、task-doc-workflow 与 dotfiles 技能；使用自身规划与主对话实施，不派生子代理。
- 在原重试分支完成用户此前授权的提交 6a239d3，仅提交实现和文档，测试仍在原 worktree。
- 更名分支基于 6a239d3；本机正式 v0.14.0 不包含本次重试修复。远端仓库名称经 gh repo view 核对仍是 joisun/tasks-recorder，未授权改名或 sun 升级。

- 源码、adapters/rillo、daemon 内部命名、MCP/header/env、CI 资产名与历史文档完成统一。新本地构建 0.15.0 未发布。
- 隔离真实 0.14.0 → Rillo 0.15.0 验证 Schedule/Run/session_links/deliveries；故意安装失败也成功恢复旧数据和命令。
- macOS 临时目录为 symlink，CLI entry 必须用 realpath；已有 Schedule type 旧标记继续识别，不重写外部用户 Markdown。
- 本机备份先后发现 WAL 文件退出时清理、遗留 Unix socket 两类情况，均触发回滚。迁移改为停止且确认旧 label 已卸载、SQLite 一致性备份、非持久 IPC 元信息记录；真实目录只读完整备份先验证，再切换成功。旧服务健康已恢复验证，最终新服务 rillo ready。
- 本机 233 条原始 Run 原样，准备期新增 1 条正常成功执行保留，总234；其他 DB 表、7 Schedule/2 enabled 与187 Markdown 完整保留。
- 原 service/config/program/log 路径已迁移；旧插件使用原生 CLI 卸载并保留插件数据，历史缓存移到 operator 备份；本地 marketplace 镜像安装 rillo@rillo 两宿主插件。dotfiles 保留其他现有改动，补齐新登记并迁移 project trust、pluginUsage。
- 根目录 rillo，34 worktree repair，其他 worktree diff/status 校验一致；旧目录为必要过渡 symlink。远端、sun、公开资产未变更。

- 补充授权后，GitHub 仓库从原名称更名为 joisun/rillo，仓库 ID 不变；4 分支 SHA、28 Release 与资产元数据完整比对一致。origin 更新为新 URL，未推送新源码、未发布、未操作 sun。
- 最终验证：backend 571/571、UI 82/82、syntax/type/build/adapters 通过；已安装两宿主 MCP 握手各25工具。Codex 原生插件隔离加载也识别25工具，无模型调用。初次隔离用例未创建 config 导致启动失败，误判路径后根据原生解析实现重新检查，恢复原路径配置并补齐隔离 config 即通过，无需产品代码修复。
- 新装经真实 install.sh 验证 metadata/UI/SSE。卸载用独立 HOME 和 launchctl stub 验证服务登记删除、用户数据保留；不触及当前服务。Linux 管理器依赖已有单元验证，本次未对真实 Linux/sun 执行迁移。
