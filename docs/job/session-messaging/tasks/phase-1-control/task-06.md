# T6：真实自发消息与轮次查询参数修正

用户明确要求向当前会话发送一条测试消息。使用新增 MCP session_send，验证原生队列准确 ID；不重复发送、不打断当前会话。修复自测发现的 thread/turns/list itemsView 参数，补充当前轮次、stale turn 拒绝与打断结果的回归用例。记录原生接受与实际收到的区别。
