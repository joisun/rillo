# 状态

- status: complete
- phase: release-v0.9.0
- current_task: Sessions与Cards完成，重连修复已验收；v0.9.0已发布并更新本地服务和插件
- worktree: /Users/joi-com/Desktop/space/projects/tasks-recorder/.worktree/feature-session-browser
- branch: feature/session-browser
- authorization: 已确认完整计划，并明确要求实施。
- next: 43127安装版和43129源码预览可用；Cards最近一轮对话预览保留为后续讨论，本期没有实现内容增强。
- commits: ff125e6、de553df、5e3052e、f4910d2、c8c4775、8cf0d8f、313ebdd、2ef0cf8；v0.9.0标签指向2ef0cf8。

v0.9.0的CI和Release均成功，完整Node586/586、React87/87、check/build及发布包安装验证通过。本地服务ready=true、API v5，Codex和Claude Code插件均为0.9.0。这里是已授权工程工作流记录，不代替产品数据。

Cards验收：React82/82、定向Sessions与事件45/45、check/build通过；真实100条会话只发1次limit=100主列表请求，不预读正文/children/timeline。合成数据1600/1280/1024/390宽度分别5/3/4/1列，无横向溢出；视图切换scrollTop1000保持不变，正文DOM不重建，过滤、搜索、键盘、终端独立操作与连接恢复通过。详见phase-7-log.md及06-test-report.md。

性能验收见phase-6-log.md与06-test-report.md：原生300条分页一致，冷连接列表946ms，热启动列表234–342ms；后端585项完整回归、前端74项完整回归及后续新增定向验证通过。冷启动不纳入热缓存目标，不把3次页面采样当成长期p95。

悬停补充验收：构建版已加载消息27–38ms选中，连续733ms移动中4次更新，当前页定位0次正文请求；手动滚动后位置稳定，重新悬停恢复跟随且三角时间一致。最新前端79/79、check/build通过；这组数据仅为本机小样本，未加载消息仍需要原生读取。

本轮Sessions32/32、check/build通过；完整Node578/578、UI72/72为上一轮记录。实际复现并修复正文已滚动但竖线/时间提示仍停在旧选择位置的问题；聚焦和悬停退出均已验证，详见06-test-report.md。后面的旧阶段数字保留为历史记录。

早期验证使用包含未提交测试的完整本地工作区。用户随后明确允许提交测试，43个相关测试文件已进入2ef0cf8，并随发布CI验证。

视觉重构增量：React 61/61、check/build通过，22条视觉覆盖记录、7项已修复发现；真实Touch模拟、键盘、reduced-motion、各视口已检查，详见phase-3-log.md及06-test-report.md。
