# 依赖审计（变更前）

npm + package-lock.json；React 19.2.8、TS strict、Tailwind 4.3.3。扫描源码/动态导入/CSS/构建/测试/CLI/服务端，排除生成文件与 node_modules；随后通过 npm ls 和锁文件检查传递依赖。

| 依赖 | 分类 | 实际用法/决策 |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk@0.3.312` | KEEP | scripts/build-server-vendor.mjs |
| `@base-ui/react@1.7.0` | KEEP | ui/react/components/ui/drawer.tsx；保留为所有交互控件唯一底层，消除现有 Drawer 中混合 Aria 的桥接 |
| `@modelcontextprotocol/sdk@1.30.0` | KEEP | test/schedule-work-hours-mcp.test.mjs；mcp/src/session-server.mjs；mcp/src/tools.mjs |
| `@streamdown/cjk@1.0.2` | KEEP | ui/react/test/toolchain.test.ts；ui/react/components/ai-elements/message.tsx |
| `@svar-ui/react-gantt@2.7.1` | KEEP | test/svar-gantt-contract.test.mjs；ui/src/svar-gantt-renderer.jsx；旧版回滚入口 compileDashboard 仍构建，不能删除 |
| `@tanstack/react-query@5.102.8` | KEEP | ui/react/app/app-providers.tsx；ui/react/app/app-shell.test.tsx；ui/react/app/dashboard-app.tsx |
| `clsx@2.1.1` | KEEP | ui/react/lib/cn.ts |
| `lucide-react@1.34.0` | KEEP | ui/react/app/navigation.tsx；ui/react/app/settings-dialog.tsx；ui/react/app/connection-status.tsx |
| `react@19.2.8` | KEEP | ui/compiler.mjs；ui/dev-server.mjs；ui/components.json |
| `react-aria@3.51.0` | REPLACE | ui/react/lib/context.tsx；ui/react/components/ui/field.tsx；ui/react/components/ui/drawer.tsx；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `react-aria-components@1.20.0` | REPLACE | test/react-toolchain-contract.test.mjs；ui/react/app/settings-dialog.tsx；ui/react/lib/context.tsx；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `react-dom@19.2.8` | KEEP | test/svar-gantt-contract.test.mjs；test/svar-gantt-cells.test.mjs；ui/react/entry.tsx |
| `react-stately@3.49.0` | REPLACE | ui/react/components/ui/drawer.tsx；ui/react/components/ui/input.tsx；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `streamdown@2.4.0` | KEEP | ui/react/test/toolchain.test.ts；ui/react/components/ai-elements/message.tsx |
| `tailwind-merge@3.6.0` | KEEP | ui/react/lib/cn.ts |
| `tailwind-variants@3.3.1` | REPLACE | test/react-toolchain-contract.test.mjs；ui/react/components/ui/list-box.tsx；ui/react/components/ui/tabs.tsx；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `tailwindcss-react-aria-components@2.2.0` | REPLACE | ui/react/styles/app.css；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `tailwindcss-with@0.0.2` | REPLACE | ui/react/styles/app.css；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `tw-animate-css@1.4.0` | REPLACE | ui/react/styles/app.css；调用方全部迁出后再删除直接依赖，不能提前移除 |
| `use-stick-to-bottom@1.1.3` | KEEP | ui/react/test/toolchain.test.ts；ui/react/components/ai-elements/conversation.tsx |
| `ws@8.22.0` | KEEP | test/codex-session-status.test.mjs；scripts/build-server-vendor.mjs |
| `yaml@^2.9.0` | KEEP | scripts/build-server-vendor.mjs |
| `zod@4.4.3` | KEEP | mcp/src/tools.mjs |

构建与测试依赖全部 KEEP：esbuild/PostCSS/Tailwind 编译两套入口，TypeScript/Vitest/jsdom/Testing Library 用于回归；不引入第二套测试框架。

没有仅凭包名判定 REMOVE 的依赖。REPLACE 类在迁移完成前仍必要。Kibo 是源码注册表，不安装全量运行时库；仅取实际需要的组件。React Bits 暂不引入：当前控制台不需要装饰特效。

风险：下拉框键盘语义、搜索浮层异步空态、Dialog 焦点恢复、非模态 Sheet keepMounted、保存期间禁用关闭、离线单文件字体打包。所有风险需对应回归。

## 完成后的依赖决策

移除 7 个直接依赖：react-aria、react-aria-components、react-stately、tailwind-variants、tailwindcss-react-aria-components、tailwindcss-with、tw-animate-css。前 6 个的所有生产调用已迁出，第 7 个的 CSS 动画改由 Motion 与共享 CSS 状态时长承担。npm 自动清除 14 个已无引用的包；不手动删除仍被其他包依赖的传递包。

新增固定版本：motion 14.9.0、@fontsource-variable/geist 5.3.0、@fontsource-variable/geist-mono 5.3.0。Motion 的 framer-motion 是引擎内部传递依赖，必须保留；Fontsource 只提供本地字体，不是第二套组件系统。React Bits 不引入。

保留：React 19.2.8、React DOM、Tailwind 4.3.3、TypeScript、Base UI、TanStack Query、Lucide、Streamdown/CJK、use-stick-to-bottom、clsx、tailwind-merge、全部服务端集成包、全部原有构建和测试工具。SVAR 仍被 ui/src/svar-gantt-renderer.jsx 和 compileDashboard 使用，及其传递依赖均保留。不存在未完成的 React Aria 消费者迁移或不明用途的 REVIEW 包。

`npm ls --depth=0`、`npm ci --ignore-scripts --dry-run --prefer-offline` 及锁文件根依赖逐项比较均通过；npm explain react-aria-components 确认不存在该依赖。原测试中的固定旧组件依赖断言已同步，仅保留本地不提交。

### Kibo 源码凭据

- `pill`：https://www.kibo-ui.com/r/pill.json，SHA256 `c1dd3d46048b0d5f3b28b4b57f130772cc326b8a6cc8f3df9211221c8bb69765`。
- `status`：https://www.kibo-ui.com/r/status.json，SHA256 `4c67a33977963d5a5e6e42f3b337011810008fa84219ff617e61038584b56b7e`。
- `spinner`：https://www.kibo-ui.com/r/spinner.json，SHA256 `1530fb401ca4f116df1b87645195cf8024623f53e2f2bf99ed60edb6cc4f715f`。

### 构建与测试依赖逐项分类

| 依赖 | 分类 | 用法 |
| --- | --- | --- |
| `@tailwindcss/postcss@4.3.3` | KEEP | ui/compiler.mjs 的 Tailwind/PostCSS 编译器 |
| `@testing-library/jest-dom@7.0.1` | KEEP | ui/react/test/setup.ts 的 DOM 断言 |
| `@testing-library/react@16.3.3` | KEEP | 现有 14 个 UI 测试文件使用 render、screen 与清理 |
| `@testing-library/user-event@14.6.6` | KEEP | 现有表单、键盘、搜索和 Sheet 交互测试 |
| `@types/node@26.4.0` | KEEP | UI 测试中 node:fs、node:path 及构建配置的类型 |
| `@types/react@19.2.18` | KEEP | React TSX 类型及 ComponentProps/ReactNode |
| `@types/react-dom@19.2.5` | KEEP | ui/react/entry.tsx 的 createRoot 类型 |
| `esbuild@0.28.2` | KEEP | ui/compiler.mjs 与 server vendor 编译 |
| `jsdom@30.0.1` | KEEP | vitest.config.ts 的测试环境 |
| `postcss@8.5.26` | KEEP | ui/compiler.mjs CSS 处理 |
| `tailwindcss@4.3.3` | KEEP | 当前 app.css @import 与 @tailwindcss/postcss 所需版本 |
| `typescript@7.0.2` | KEEP | tsconfig strict 与 check:types |
| `vitest@4.1.11` | KEEP | vitest.config.ts、test:ui 以及 UI 测试 API |
