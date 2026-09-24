# OpenCode 定时执行器

用户已批准 Server API 方案并要求直接推进。范围为现有 Schedule/Run 流程新增 opencode runtime，不包含交互工作记录插件和发布。

1. 新增受管本地 OpenCode Server client：随机端口、随机认证、HTTP 响应/SSE有界、启动/关闭与请求超时。只终止自己启动的服务。
2. 实现创建 Session、异步发送、实时文本/工具事件、终态检查、取消/超时、会话历史。session ID 创建即上报；SSE断开用持久消息/状态补读并重连；追加指令记录独立message ID避免旧idle误完成。
3. 注册 runtime，按provider/model与variant校验。首版不支持OS sandbox，只接受明确danger-full-access；技能/MCP继承本机设置，不支持禁用且不得静默忽略。权限/问题等待以明确错误结束。
4. UI按执行器显示配置；终端支持OpenCode恢复，Codex行为保持不变。
5. 先写契约测试并验证失败，再实现；跑定向、全量后端/前端、类型与构建；真实OpenCode隔离任务验证执行、产物、追加指令、取消、历史。

测试文件仅用于验证，本次不提交代码。工作区基于v0.8.5，保留主checkout所有既有改动。

## 实施与验证结果

- 已注册 OpenCode runtime，复用 Schedule/RunService；HTTP+SSE、模型/variant、取消/超时、历史读取与 Terminal Resume 接通。
- React 与 legacy 编辑器同步支持 OpenCode，强制明确无 OS sandbox、继承 Skills/MCP；原生安装路径 `.opencode/bin` 纳入解析。
- 修复真实验证发现的用户文本重复输出、消息排序、冷启动请求超时；修复错误消息无完成时间与取消后追加指令返回 accepted 的竞态。
- 本机 OpenCode 1.18.31 实跑：一次性计划自动触发，Run 为 succeeded，生成 delivery.txt，ledger 记录 add，历史读取成功；运行中追加指令按新要求输出 STEER_DELIVERED；运行中取消为 canceled，保留 Session。
- Playwright headless 验证冷启动编辑器可以选择 OpenCode；runtime/models 请求均为 200，无 console error。
- `npm run build`、`npm run check`、`npm test`（561 项）、`npm run test:ui`（85 项）、`git diff --check` 通过。
- 已同步 README 与 architecture；初次验证时未提交、合并或发布，未改动已有用户定时任务。

## v0.8.6 发布准备

用户已授权提交、发布并更新本地。版本元数据同步至 0.8.6；新增功能测试不纳入提交。发布测试中 3 个文件含固定版本断言，已仅同步版本字符串并验证，用户已明确授权这三个文件的版本同步纳入提交。
