# 用例

| 优先级 | 对应任务 | 输入/操作 | 预期 |
| --- | --- | --- | --- |
| P0 | 后端 | native list 带 cwd，read 带 session ID | workspace 精确、recency 正确、身份稳定 |
| P0 | 后端 | 正文关键词不在标题，指定 workspace | 调 thread/search，过滤其他目录且保留后续 cursor |
| P0 | 后端 | 连续三页无该目录结果 | 有界返回空列表及 continuation |
| P0 | 后端 | searchOccurrences 命中超长消息 | 从 turnCursor 读取，高亮原文可见，排除工具/reasoning |
| P0 | 后端 | 错 store、未知 provider、非法 query、跨源请求 | 拒绝且不启动终端 |
| P0 | 后端 | resume body 附 workspace/command | HTTP 拒绝额外字段；有效恢复使用原生 metadata 和设置 |
| P0 | task-03 | 终端与查询的 CODEX_HOME 不同，路径含引号/特殊字符 | 显式传可信数据根，作为单一字面值，不执行插值 |
| P1 | 后端 | 老 Codex unknown variant/-32601 | typed unsupported，不改搜标题 |
| P1 | 页面 | 选择目录、Enter 搜索、点结果 | 参数对应当前目录/关键词，定位首处命中 |
| P1 | 页面 | 查看最近对话、终端继续 | 清除定位参数；仅显式继续才调用恢复 |
| P1 | 页面 | 空分页、目录异常、unsupported | 有后续继续入口，失败不标完整，不静默降级 |
| P1 | 页面 | 1440×960 / 390×844 列表与预览 | 无页面横向溢出，窄屏可返回 |
| P1 | 回归 | build/check/test/test:ui/diff | 通过，相关活跃文档同步 |
