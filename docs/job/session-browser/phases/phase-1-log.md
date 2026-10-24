# 后端执行记录

2026-10-23：完成 createSessionBrowser、Codex adapter 与 API。统一来源引用、参数上限与错误；恢复只使用服务重新读取的 metadata。真实 Codex CLI 0.163.0 验证正文查询和首处命中定位成功，测试不输出原文。原生 search 无 cwd，需要在 adapter 中分页过滤；有 continuation 时保留空页状态。兼容旧 Codex 的 unknown-variant 错误，明确提示不支持，不回退标题搜索。

新增 9 条 adapter/边界/HTTP 测试；原 app-server client 新增旧版搜索方法错误分类用例。专项测试通过，原有 runtime/resume 测试通过。未创建 commit，遵循用户未授权不提交规则。

最终检查追加 task-03：终端环境可能与读取时的数据根不同。adapter 的可信 resumeOptions 指定 codexHome，Terminal/Ghostty/Otty 恢复命令均显式传 CODEX_HOME，HTTP 仍仅接受 store_id。新增带引号、空格、shell 特殊字符路径的 launcher 用例；省略新选项的旧入口命令不变。24 条会话/终端/原恢复专项测试通过。无 commit。
