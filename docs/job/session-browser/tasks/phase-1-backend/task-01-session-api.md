# 会话 adapter 与 API

新增统一 SessionService 与 Codex provider。列表、workspace catalog、正文搜索和历史按页返回；跨 provider 身份由 provider/store_id/session_id 组成。store_id 由服务配置派生，浏览器不能选择任意数据目录。错误必须明确区分不可用、不支持、无结果与还有更多页。

验收：假 adapter 验证边界与路由，真实 Codex 验证正文搜索能命中标题之外内容；恢复请求只携带会话引用，metadata 与 workspace 均由 adapter 取得。
