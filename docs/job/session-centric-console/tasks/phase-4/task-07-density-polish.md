# 紧凑阅读与真实消息密度

用户追加7项要求：对话空间、行内终端继续、Linear式紧凑布局、hover替代按住、主动代入调试、真实消息时间/密度折线、展开折叠与空子树打磨。授权直接实施，不发版/替换43127。

确认依据：Linear官方设计文章强调弱化导航、减少分隔与固定工具位置；当前Codex thread/items/list确有startedAtMs/completedAtMs，旧实现只补读目标Turn前100项时间。

实施：独立有界metadata消息索引，timeline新增points/points_coverage/untimed_messages，按原生item分页定位/读正文；无正文持久化。两种分页以opaque cursor组合，旧版无能力时显式Turn级，不编造时间。行内终端按钮与正文选择分开；正文头部两行，关系移浮层；曲线同尺度消息计数、实际消息刻线、hover吸附原生时间与120ms防误触。展开查询保留缓存，加载/空/失败均在行内反馈，数据在paint前同步。

验收：真实Codex只读ID/时间一致；核心与完整Node、UI、类型/构建；模拟浏览器反复折叠、空树、hover/取消、搜索、消息手动滚动和终端按钮（mock启动）。截图只用合成数据。

结果：完成。Node566/566、React63/63、check/build通过。1600桌面正文859×800px、header65.75px；375触屏分栏正文218px，一键展开558px。三次折叠重开无新children请求，空叶与503重试通过；行内resume保持预览，关系浮层不改变正文高度。原生读取11个point，message精度、item ID、时间均一致。16条视觉覆盖记录/7项已修复问题，报告校验通过；43130为最新构建，43129为源码预览。
