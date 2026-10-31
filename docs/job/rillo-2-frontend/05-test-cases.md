# 验证矩阵

| 范围 | 方式 | 成功条件 |
| --- | --- | --- |
| 导入/类型/语法 | npm run check | 162 文件语法及 strict TypeScript 通过 |
| UI 业务回归 | npm run test:ui | 89 项通过，包含搜索、层级、Pin、编辑、工作时段、实时 Run |
| 构建与依赖契约 | 6 项 node:test + npm build | 新旧入口可构建，无外链字体 |
| 锁文件 | npm ls / npm ci dry-run / 根依赖比较 | 依赖树有效，package 与 lock 一致 |
| Sessions | 浏览器桌面/手机 | Sheet 宽度不挤树，minimap/搜索/键盘可用，无溢出 |
| Scheduled/Settings | 浏览器桌面/手机 | 所有表单控件和弹窗可操作，未修改正式数据 |
| Run | 浏览器与回归 | 详情不被遮罩，缓存重开仍自动展示 Run |
| 无障碍 | 键盘 + reduce motion | 焦点、Escape、ARIA 名称、减少动态效果均可用 |
