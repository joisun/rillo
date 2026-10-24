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

## 并行所有权

主agent负责核心SessionBrowser、session-link-store、Codex session adapter、核心新测试、工程文档、README/architecture和dotfiles。UI worker负责ui/react及CSS。服务worker负责API/taskd/MCP/adapters/hooks/CLI及对应test。跨所有权接口先沟通，不撤销彼此改动。
