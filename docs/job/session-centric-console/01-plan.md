# 实施计划

## 全局约束

在 feature/session-browser 现有隔离worktree继续，保留已验证Sessions与0.8.8基线；不改主checkout。数据源仍由CLI维护，仅新建session-links.sqlite保存登记关系。旧Task数据库不打开、不迁移、不删除。Scheduled继续使用原Run ledger。

## 实施与接口

1. 核心：关系store、SessionBrowser关系与分页children、Codex原生关系/轮次时间/按时间seek。具体会话引用使用thread.id，不使用fork共享的root sessionId。
2. 服务：API v5、无Task启动链路、Session MCP；插件仅暴露关系登记/解除/来源查询，旧Task route为410。Scheduled与Sessions故障隔离。
3. 界面：Sessions共用列表/消息热力条、筛选和选择；每条会话独立起止、按秒计数，悬停即可浏览，键盘/触屏定位；滚动自动分页，连接错误整页集中展示。fork来源单独跳转。
4. Otty：在dotfiles canonical skill接入一次登记；只对新建协作子会话执行，resume/fork不自动改挂。身份或服务不可用时提示未登记且不阻塞终端。
5. 验证：核心/协议/原生读取、Scheduled回归、前端交互、隔离预览、文档同步。
6. 用户追加的视觉重构：采用上游UI/UX Pro Max与visual-driven-review，依据截图改善布局、字号、手机与指针坐标。最新task-09替代此前折线/全局时间窗：350px侧栏、12px正文、标题右侧起止时间、行下方每秒矩形热力格、自动加载/跟随、会话及目录绿点；不持久化正文，不改变调度。
7. 用户追加Cards视图：先提交性能修复，再在Sessions中增加Cards，复用会话列表、搜索与正文。原生preview仅作文本预览，不生成摘要；视图偏好与滚动状态保留，卡片首屏不额外读正文或关系。用户对实用性的反馈保留为下一轮内容方向讨论。

## 并行所有权

主agent负责核心SessionBrowser、session-link-store、Codex session adapter、核心新测试、工程文档、README/architecture和dotfiles。UI worker负责ui/react及CSS。服务worker负责API/daemon/MCP/adapters/hooks/CLI及对应test。跨所有权接口先沟通，不撤销彼此改动。

## 加载性能增量（用户已明确要求“开始推进”）

前台thread/list使用原生useStateDbOnly；扫描修复使用独立、按数据源合并的后台连接，最多每5分钟核验一次。空索引须等待核验，失败不能显示成空列表。目录与根列表统一100条，原生cursor原样继续，不截断后丢行。仅保留最多64页、30秒的进程内元数据缓存，同参数合并请求，3秒后先返回缓存再刷新。搜索和正文不进入缓存。

原生通知与受限日志目录watch合并发出修订；前台15秒可见页面轮询兜底。离屏停止预读，用户定位优先并保留并发位置。完整历史时间索引仅在日志前缀哈希未变、原末消息仍存在时复用，重写、截断、撤回或缺少证明均重新读取；不推测消息时间，不新增持久正文数据。

成功证据：真实冷/热首屏分别测量；缓存命中、后台核验期间、切换目录及打开正文采样；原生普通查询与快速查询分页身份核对，空索引历史修复、失效、关闭和回滚回归通过。
