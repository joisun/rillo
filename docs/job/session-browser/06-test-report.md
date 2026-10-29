# 验证结果

2026-10-23，feature/session-browser 隔离 worktree。

- `npm run check`：137 个 source 文件语法检查与 TypeScript 通过。
- `npm run build`：server vendor 和生产 React bundle 构建通过。
- `npm test`：567 条通过。
- `npm run test:ui`：87 条通过。
- `git diff --check`：通过。
- 真实 Codex CLI 0.163.0 / 真实 HTTP：列表返回成功，正文查询存在 title/preview 都不含关键词的命中；messages 接口成功定位并包含匹配消息。仅输出数量、状态和布尔结果，没有保存会话正文。
- Playwright headless：1440×960 与 390×844 检查目录筛选/选择、归档、搜索、命中、高亮、恢复反馈、列表返回、空结果、不支持错误；无页面横向溢出。截图使用合成数据。最终恢复真实 API 后，页面显示 30 条首屏会话，控制台无新错误。
- 文档树已枚举并按受影响符号及行为检索；同步 README 与 architecture。历史 specs/plans 保留历史语境，不当作当前契约修改。

定向视觉报告：`/tmp/.vdr-log/2026-10-23-session-browser/report.html`，同目录有 Markdown 和 6 张截图。视觉确认问题 0，归并问题 0。一次 dev 热重载 SSE 中断和注入的 501 已确认来源；没有产品脚本异常。

已闭环：测试中发现的自定义 CODEX_HOME 恢复错源风险转为 task-03，修复并覆盖路径字面值转义、原恢复链路和 HTTP 边界。无未解决 P0/P1。

限制：当前只实现 Codex provider；依赖其实验搜索/定位/分页接口，旧版显示不支持。只定位首处正文命中。预览长消息有明确节选提示，分页目录数量是观测数量。实际 Terminal/Otty/Ghostty 启动未在本次自动验证中执行，沿用 launcher 并使用 mock 检查命令及反馈；不能声称已完成真实终端端到端测试。

交付：`http://127.0.0.1:43129/?view=sessions` 实时源码预览，独立 daemon 位于 43130。Recorder 使用临时目录和空 definitions，Codex 读取用户本机数据源。未创建 commit、未发布或替换已安装服务。任务记录 MCP 为 SERVICE_UNAVAILABLE，未绕过服务写入数据库。

后续交互调整已验收：截图框选的标题/副标题、归档按钮、搜索/目录/页脚说明已移除。搜索改为居中的输入框下方浮层，主时间线不被搜索替换，workspace/branch 与 title 同行靠右。支持键盘、Escape 和外部点击关闭。Active 通过独立状态查询更新，浮层、列表和详情均验证；探测失败撤下标记。当前文案以 README/architecture 为准，上面的初版归档检查仅为历史验证记录。新视觉证据位于 `/tmp/.vdr-log/2026-10-23-session-refinement/`。
