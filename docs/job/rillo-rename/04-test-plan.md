# 验证计划

验证源码标识、真实安装与数据连续性三个方面。旧标识扫描覆盖所有活动源码、文档、插件、构建产物及本机配置；迁移识别、备份和不可变历史单独列出。

- 运行 backend、UI、syntax/type 与构建检查。
- 真实安装包在独立 HOME 验证新装、0.14.0 升级、故障回滚和卸载保留数据。
- 已安装 Codex/Claude MCP 完成 initialize、tools/list 与只读查询；Codex 原生宿主实际加载插件，无模型请求。
- 迁移前后核对 SQLite 表哈希、原始 Markdown 字节哈希、Schedule ID/enabled/etag、已有 worktree 修改。
- 检查本机唯一服务、CLI、health/meta、浏览器标题和插件登记。
- 远端更名只修改仓库身份及描述，比较分支 SHA 和 Release 资产元数据；不发布或操作 sun。
