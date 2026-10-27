# Linux 支持

范围：在既有 Sessions 改动上补齐 Linux Web 服务安装、systemd 用户服务、Dashboard URL 入口、双平台包及 CI。用户已授权使用 SSH pane p_1a17bea73e2_e 实验，结束后清理远端实验资源；本轮不提交或发布。

## 环境与计划

- Ubuntu 26.04.1 x86_64；systemd user manager 正常；无桌面，已安装 tmux 和 Codex；无 Node。
- 独立工作树 feature/linux-support，Linux 修改前源快照位于 /tmp/tasks-recorder-linux-baseline；既有 Sessions 改动保留。
- 先补系统入口，再做聚焦测试、完整回归与远端隔离验收，最后更新文档并清理。
- 远端实验目录：/tmp/tasks-recorder-linux-57poah5d；临时 Node 校验官方下载 SHA256。

用户补充：不实现 tmux 或 Linux 终端恢复；通过 Web 查到 Session ID 后由用户自行在终端 resume。Linux 不从服务器打开用户桌面应用。

## 进度

- [x] Linux 安装、用户服务与发布包
- [x] Linux Web 浏览、复制 Session ID 与 Dashboard URL 入口
- [x] 单元与回归测试
- [x] 远端真实安装、服务、调度与会话验收
- [x] 文档同步与远端清理确认

## 资料

- https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
- https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
- https://man.openbsd.org/tmux

## 实机发现与修正

- 首次 systemd unit 启动失败：WorkingDirectory 是整值路径，不能套用 ExecStart 的词项引号规则。对照 systemd.syntax / systemd.service 文档和实际 journal 错误后，按不同指令分别编码；增加 Linux 真实 parser 测试。
- Ubuntu 首次 npm ci 下载返回 HTTP 200 但超过300秒；运行包不需要 npm 安装，服务验证先使用本地构建的自包含包。源码测试复用临时缓存，不修改全局 Node/npm。

## 验收结果

- Ubuntu 26.04.1 x86_64、临时 Node.js v24.22.1：构建、语法/类型检查通过；服务端602/602、UI104/104通过。最后调整的controller timeout与发布元数据检查另在Ubuntu聚焦复验15/15。
- macOS：服务端601项通过、1项Linux真实parser测试按平台跳过；UI104/104，构建、类型检查和发行包验证通过。
- 实际systemd：unit verify成功，启动、停止与再启动成功，HTTP Dashboard及原生Codex空数据源查询均200；providers.resume=false、settings.local_actions_supported=false。实验使用临时CODEX_HOME，没有读取或修改原有Codex数据。
- 实际浏览器经SSH转发访问Ubuntu服务：无终端启动按钮，设置不出现终端选择；示例会话ID linux-copy-demo正确复制到浏览器剪贴板，条目仍为三层。示例数据仅用于浏览器拦截，没有写进原生会话或关系库。
- Linux包、macOS包及两个adapter包均构建成功，SHA256SUMS位于本机临时构建目录；尚未提交或发布。仅补齐CI配置，没有触发GitHub工作流。

## 清理结果

- 已停止、禁用并删除tasks-recorder-linux-smoke-57poah5d.service；systemd LoadState=not-found，用户目录不存在该unit链接。
- 已确认正常卸载保留实验配置，随后删除整个实验目录/tmp/tasks-recorder-linux-57poah5d，包括Node、源码、npm依赖/缓存、原生临时索引、SQLite和测试日志。
- 远端残留测试进程0；原SSH环境中node仍未安装，原用户数据和配置未修改。
- 本机测试SSH转发已停止，43163未监听；指定pane保持原SSH会话。
- 精简验证输出保留在本机/tmp/tasks-recorder-linux-baseline/remote-results，截图位于本工作树忽略的.vdr-log/2026-10-27-linux-web/。

## 文档同步

扫描了Markdown文档树，更新README和architecture中的Linux入口、systemd生命周期、loopback转发与桌面能力约定；历史job/spec记录保持原样。

## 发布记录

2026-10-27：用户授权提交、发布并更新本地。开发验收阶段的不提交约束已结束；Sessions 改造已提交为9f7b12f，Linux适配单独提交，随后准备v0.11.0。远端实验资源保持已清理状态。

版本准备：Linux适配提交为16480f2。v0.11.0 的最终构建、类型检查、完整服务端测试、104项UI测试和双平台打包通过；macOS共602项服务端测试，601项通过，1项Linux专用测试跳过。安装前已备份本地活动数据库、配置与计划定义校验值。
