# 实施计划

1. 扩展 Markdown/API/MCP 任务字段，保持旧定义默认 new；在 Run 创建事务内选择上一兼容 session，原生适配器实现 resume。
2. 自动模式注入下一轮选择协议，只接受成功执行最终输出的末尾标记，记录仍以原生 Run 为依据，避免第二份会话数据库。
3. 增加 Runtime 设置读取接口，从 Codex 有效配置动态读取自动压缩阈值；自定义仅覆盖本次运行。编辑器打开、切换 workspace、焦点回到页面及打开期间定期刷新。
4. 增加 session-control compact HTTP/MCP、provider 能力及回执，Codex 不接受自定义压缩说明，Claude 使用原生 /compact。
5. 验证新建/继承/自动首轮与后续、跨 workspace/runtime 隔离、恢复失败、配置变化、compact 幂等/忙碌/超时、表单及文档。

使用现有组件与存储结构，必要时新增共享会话策略模块；不引入 UI 依赖，不自动提交阶段。
