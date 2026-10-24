# 已确认需求

2026-10-24 用户明确要求 Implement the plan，授权实施已确认方案。

主入口收敛为 Sessions 与 Scheduled。完整停用 Tasks 的 UI、任务维护 hook/MCP、摘要、归属和 checkpoint 链路，旧数据库和生成文件保留不动。Sessions 提供列表及会话树＋热力时间轴；以后可增加卡片，不建立第二份会话正文。

原生 fork、subagent 与外部子会话关系分开。协作层级为单向树，一个子会话一个主会话，拒绝反向和环。fork 是历史来源，不自动转为协作子节点。提供接口、MCP 并接入 canonical Otty skill。

热力图使用真实执行片段。行内 hover 控件可拖动，拖动锁定本行会话，右侧原文按时间定位；不是全局游标。悬停不抢选，松开保留。缺失或不完整时间不伪装为零或持续执行。

本期Codex完整数据源；保留provider/store/session引用以便后续Claude。保留既有搜索浮层、居中入口、来源标签、Active与终端设置。禁止自动提交、发版、替换已安装服务或删除用户数据。
