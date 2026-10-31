# 实施日志

- 开始：本地主分支工作区仅有前序测试改动。未创建提交。已检查 definition codec/service、Run store/service、Codex/OpenCode runtime、会话消息控制及 MCP 客户端。
- 定义与执行：新增 thread_mode(new/reuse/auto)、max_inherit_runs(默认20)、auto_compact_token_limit(null跟随)。事务内按 schedule/runtime/workspace 选择上一原生会话，保存实际模式、原因、序号。Codex/OpenCode 原生 resume 失败不新建兜底。自动选择只取成功结果末尾标记，继承上限优先。
- 动态设置：Codex 新 stdio 连接 config/read；每次执行不覆盖时采用本地配置。表单打开/目录变化/焦点返回/15秒轮询更新括号值。真实本机读取为未设置；隔离配置60k→80k变更已在 computer use 中看到自动刷新。
- compact：HTTP /api/v1/session-control/compact 和 MCP session_compact。Codex 原生开始与完成分开，通过回执查询完成；未知结果不重发；Claude SDK/CLI 的消息回显不算完成，compact_boundary 才确认。已补忙碌、自定义指令边界和重复请求测试。
- 真实实验：通过独立临时 HTTP API、MCP 握手和本机 Codex daemon，对实验副本 01a19265-1c04-7833-8d27-154619acdd1d 压缩，原生先返回accepted，约22秒后回执completed=true。全局配置SHA256未变化；原归档来源未操作。
- UI：用户要求停止visual-driven-review，改用CUA Chrome直接操作。已验证新建/继承/自动说明、默认20、60k→80k热刷新、自定义70k、保存后回读3轮/自动/70k，以及首次新建→继承1/2→继承2/2→上限新建标签。发现三行记录拥挤后将标签移到状态同行，重新查看最终布局。
- 验证：npm run check通过（163源文件+严格TS）；18个后端测试文件108项通过；完整UI测试15文件91项通过；生产构建和两个MCP bundle生成通过；git diff --check通过。README和architecture同步完成，历史设计文档保留历史版本约束，不改写历史记录。
- 收尾：临时preview/gateway/HTTP测试服务、隔离配置与任务目录均清理。保留前序工作区测试改动。不提交、不发布、不更新安装版。
