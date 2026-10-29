# Rillo 更名与本地安装迁移

产品展示名称为 Rillo，CLI、包、插件、MCP server、路径与发布资产前缀为 `rillo`。本次本地构建版本是 0.15.0。

## 当前状态

- 源码与本机程序已更名。命令为 `rillo`，数据目录为 `~/.config/rillo`，安装目录为 `~/.local/share/rillo`，macOS 活动日志为 `~/Library/Logs/rillo`。Linux unit 为 `rillo.service`，macOS label 为 `com.joi.rillo.daemon`。
- 本机 Codex 和 Claude 插件均为 `rillo@rillo`，MCP server 为 `rillo`。本地 marketplace 镜像位于 `~/.local/share/rillo/marketplace`，与公开下载状态无关。
- 用户补充授权后，远端仓库已实际更名为 [joisun/rillo](https://github.com/joisun/rillo)，本地 origin 同步到新地址。仓库 ID `1332808132` 不变；更名前后的 4 个分支 SHA、28 个 Release 及其资产 ID、名称、大小和 digest 完全一致。本次源码尚未推送，远端 main 仍为更名前版本。
- 没有发布 Rillo 0.15.0，也没有操作 sun。公开下载与 marketplace Git 安装命令需等新源码推送和正式发布后再使用。当前本机使用已校验的本地构建包。

## 安装迁移行为

`install.sh` 校验包名、版本、根目录与 SHA256 后执行 `server/migrate.mjs`。迁移先检测旧数据和新数据目录冲突、服务归属、当前活跃 Scheduled Run；无法确认时停止操作并保留旧服务。存在运行中的任务时须等其结束。

确认后停止并卸载旧服务登记，等待管理器确认旧 label 已卸载，再做 SQLite 一致性备份和持久文件备份。socket、FIFO 等 IPC 只有元信息，没有可备份的持久内容；原始目录迁移时仍保留这些历史文件。数据库、外部 Markdown 和 CLI-owned transcript 不做品牌字符串替换。新服务健康前失败会恢复旧路径、原配置和服务。

备份和事务日志保留在 `~/.local/state/rillo-migrations`。两套数据目录同时存在时不覆盖、不自动合并。`--no-start` 不允许切换正在运行的旧服务。卸载只删除程序及服务登记，保留用户数据、日志与迁移备份。

当前本地包的安装方式如下。将目录替换为实际已经构建并校验的发布目录：

```bash
RILLO_RELEASE_BASE_URL=file:///absolute/path/to/local-release bash install.sh --version v0.15.0
rillo status
```

## 保留的旧标识

旧名称只在下列迁移识别、说明或不可变历史资料中保留：

| 位置 | 原因 |
| --- | --- |
| `server/migrate.mjs` 与迁移测试 | 识别 `tasks-recorder`、`task-recorder` 和下划线目录变体，备份并恢复旧 CLI、数据和服务。 |
| `schedule-definition-codec.mjs` 与兼容测试 | 接受已有 `tasks-recorder/schedule` 等旧 type，避免用户现有任务被忽略。新建及显式编辑只写 `rillo/schedule`。 |
| `legacy-launchd-cleanup.mjs` | 识别并停止更名前独立的 per-Schedule LaunchAgent，防止重复调度。 |
| `legacy-preferences.ts` 与测试 | 将浏览器本地偏好复制到新 key；写入失败不删除旧值。 |
| 本文与更名任务日志 | 说明旧安装的发现、事务回滚、授权范围与真实远端状态。 |
| 原工作区路径软链接 | 本机主目录已为 `/Users/joi-com/Desktop/space/projects/rillo`。旧目录名暂时只作为指向新目录的过渡软链接，维持已有会话的 cwd 和并行 worktree 工具入口。 |
| 用户数据和历史原生会话 | 原 Markdown、SQLite 历史文本、native transcript/cwd、过往日志、旧版本安装内容不改写。 |
| 迁移备份和非活动旧分支 | 保留可恢复的旧插件缓存、配置、服务描述及其他开发任务，均不作为新活动 service/plugin 的入口。 |
| Git 对象与已公开资产 | 不重写 commit，不覆盖或重新打包旧 Release 文件，不改变已发布 SHA256。 |

环境变量统一使用 `RILLO_` 前缀，HTTP 版本头为 `X-Rillo-Api-Version`。旧 `AGENT_TASKS_` 和 `TASKS_RECORDER_` 不再用于活动配置。原生 provider 的 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 与各自 Session ID 不因产品更名改变。

## 历史发布

仓库更名后 GitHub 将旧地址重定向到新地址；以下保留原始历史链接用于追溯，不代表旧资产被重新命名。

历史资源保持其真实名称和校验值，不能将 URL 字符串改成新名字来表示远端资源已迁移：

- [更名前的 v0.14.0](https://github.com/joisun/tasks-recorder/releases/tag/v0.14.0)。
- [历史 v0.9.0](https://github.com/joisun/tasks-recorder/releases/tag/v0.9.0)。
- [v0.9.0 Release workflow](https://github.com/joisun/tasks-recorder/actions/runs/40263072239) 和 [CI](https://github.com/joisun/tasks-recorder/actions/runs/40263072347)。

后续发布使用 `rillo-macos.tar.gz`、`rillo-linux.tar.gz`、`rillo-codex-adapter.tar.gz`、`rillo-claude-adapter.tar.gz` 和新的 `SHA256SUMS`。
