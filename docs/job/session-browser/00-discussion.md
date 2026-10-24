# 会话浏览需求

用户希望按 workspace 浏览会话、按时间排列、跨项目搜索，并能预览及恢复。2026-10-23 的“开始推进”授权执行此前讨论的第一版。

## 范围

- 新增独立 Sessions 页面，先支持本机 Codex。
- 目录分组、最近活跃时间、归档筛选、正文搜索、命中定位、分页预览、终端恢复。
- Session adapter 统一结果结构和能力说明，为 Claude Code 留接口；本次不实现 Claude adapter。
- 原始会话由工具维护，Tasks Recorder 不建立 transcript 数据库。

## 排除范围

不实现删除、重命名、自动总结、语义向量检索、多机同步和新一轮 Web 对话。不发布、不提交、不替换主目录的未完成改动。

## 已验证依据

本机 Codex 0.163.0 支持 thread/list、thread/search、thread/searchOccurrences 和分页历史。正文搜索需要 experimentalApi；thread/search 没有 cwd 参数，过滤工作区时必须保留原始分页游标。版本缺少能力时返回明确错误，不降级成标题搜索。
