# 实施计划

## 约束

在独立 worktree feature/session-browser 开发。基于 origin/main，保留 release/session-id-0.8.8 中已验证的本地功能作为未提交基线；不修改主 checkout。原文、命中片段和消息只保存在请求及页面内存。浏览器不能提供 executable、数据目录、命令或恢复 workspace。恢复时用原生会话 metadata 重新确定目录。

## 顺序

1. 实现 createSessionBrowser 和 Codex adapter，统一列表、目录、搜索、历史与恢复引用。
2. 添加受 loopback Host/Origin 与 JSON 校验保护的 API。
3. 实现 Sessions 页面、目录侧栏、纵向时间线、正文命中与消息预览，复用现有 React Aria 组件和设计 token。
4. 单元及 API 回归、真实只读 Codex 查询、浏览器桌面与窄屏检查；启动隔离预览。

## 可交付结果

可运行且可复查的本地预览。完整读取与分页状态对用户可见。Claude 扩展通过注册独立 adapter 完成，不要求它实现 Codex 的原始协议。
