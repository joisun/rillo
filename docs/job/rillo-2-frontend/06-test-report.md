# Rillo 2.0 前端交付报告

已完成依赖审计、清理、设计系统、现有核心 UI 重构和浏览器验收。业务层、API、数据库、调度器、运行时和 Session 生命周期未改。保留此前尚未提交的 minimap/悬浮 Sheet 改动及其他开发任务的修改。

## 组件迁移

- Kibo Status/Pill/Spinner 已用于连接、执行状态、cadence/Run 标签和加载状态。组件源地址、许可证与精简项见 registry/README.md。
- 原 Button、Input、SearchField、Switch、Select、Dialog、Sheet、Popover、Tooltip、分段导航统一到 Base UI + shadcn 组件组织。删除未使用的 ListBox、Tabs、Text、Separator、旧 Drawer 桥接、Aria context 和仅测试使用的 IconButton 包装。
- Sessions 保留原树/搜索/Pin/关系与垂直 minimap；Scheduled 保留创建、编辑、启停、工作时段、运行和查看产物；Run 历史/实时对话与设置继续使用原接口。
- CSS 从双重色板收敛为一套语义变量，Geist 字体内嵌。删除 118 条仅属于已移除 Tasks/Gantt React 页面的旧样式规则；ui/src 旧版回滚代码未改。
- Motion 采用 150/220/300ms 约定，覆盖分段选中、浮层、Sheet、侧栏展开和会话重排；尊重系统减少动态效果。未增加 toast、Overview、React Bits 或其他产品入口。

## 验证结果

- `npm run check`：162 源文件语法检查与 strict TypeScript 通过。
- `npm run test:ui -- --maxWorkers=2`：14 文件、89 项通过。
- React 构建、工具链及 SVAR 契约：6 项 node:test 通过。
- `npm run build`：生产构建通过，导入可解析，字体与脚本保持离线单文件。
- `npm ls --depth=0`、npm ci dry-run 及 package-lock 根依赖比对通过。
- `npm run lint --if-present` 已执行；项目没有独立 lint 配置/命令，不能声称 ESLint 检查通过。现有静态检查为语法与 TypeScript。
- 浏览器覆盖 Sessions、Scheduled、编辑器、Run 和设置，1440×900 与 390×844；键盘搜索选择、Escape、Home/End、reduced-motion、无横向溢出。已修复编辑器 480px 误覆盖、Run 遮罩层级、缓存重开 Run 选择被重置的问题，以及中性主题覆盖 Agent/Ready 语义颜色的问题。
- 真实数据只读验证：100 条树节点；浮层开关前后列表宽度均 1090px，正文和一个垂直 minimap 可见。一次既有服务的长会话索引分页返回 503，正文仍可读且未触发整页重连；不属于本次前端改动的后端修复范围。测试数据浏览器流程无控制台错误。

## 交付与剩余工作

`package.json` 与 `package-lock.json` 已同步。7 个已替代依赖及全部保留项见 dependency-audit.md。无待迁出的 React Aria 消费者；SVAR 与其传递依赖按回滚构建需求保留，未来删除回滚入口时才能移除。没有新增产品能力。

源码可通过开发端口 43128 查看；正式 43127、已安装 release、sun 和远端仓库未更新。版本仍为 0.15.0。重构验收时尚未提交；后续用户已授权执行本地提交，未授权推送或发布；测试遵照用户规则保留本地。已扫描 177 篇 docs Markdown 及 README/组件维护材料，只更新受影响的活跃文档，历史 spec 和 job 记录保留。

浏览器图文验收：`.vdr-log/2026-10-31-rillo-2-frontend/report.md` 和 `report.html`（本地忽略，不发布测试数据）。
