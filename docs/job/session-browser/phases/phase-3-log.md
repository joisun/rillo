# 交互精简执行记录

2026-10-23：按用户反馈完成 Active、搜索浮层与截图框选内容清理。macOS lsof 只匹配当前 canonical Codex 数据根下的日志写入句柄，2 秒/4 MiB 上限，缓存 3 秒，activity endpoint 在前台每 5 秒轮询。真实当前会话被观测到；探测失败清除旧标记，不推断其已结束。

搜索输入 300 毫秒 debounce，使用 React Aria ComboBox/Popover/ListBox，独立于目录时间线。官方 ComboBox 文档与本地实现确认，受控 value 必须更新，选择后才会关闭；已修正并覆盖键盘用例。官方 Collections 文档/Context7 确认动态元素按 item identity 缓存；将 isOpen 纳入派生 item，修复浮层内 Active 不随轮询刷新的问题，新增回归测试。

后续按用户要求居中搜索入口，将 workspace/branch 以更清晰的标签放在 title 同行靠右。1440 和 390 宽度下搜索容器中心偏移均为 0，标签与 title 同行靠右，无页面横向溢出。截图为合成数据；恢复真实 API 后观测到当前会话 Active，未保存个人会话截图或正文。

验证：137 个源文件语法检查、类型、生产构建及 diff 检查通过；全量后端 567 条、前端 87 条通过；activity API 补充断言的专项 12 条通过。Playwright 检查输入框下方浮层、Escape、方向键/Enter、外部点击、选中后定位、窄屏返回、Active 在详情和搜索浮层刷新/撤下。无 commit，无发布。

源码预览仍位于 43129，上游隔离 daemon 为 43130。当前 Tasks 是否保留进入讨论，未据此执行删除。
