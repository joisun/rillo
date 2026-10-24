# 终端恢复数据根

检查发现终端继承的 CODEX_HOME 可能与 taskd 数据源不同。由 Codex adapter 提供可信 resumeOptions.codexHome，launcher 显式带入 CODEX_HOME，浏览器仍只能提交 store_id。省略该选项的既有 Task/Run 入口保持原有命令。

验收：包含空格、引号和 shell 特殊字符的数据根作为一个环境变量值传入，不执行插值；HTTP 不接受该覆盖参数；原终端测试通过。
