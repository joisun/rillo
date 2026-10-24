# Sessions视觉与交互重构

2026-10-24用户要求寻找流行UI/UX skill，对本期新增页面视觉验证并允许重构。选择nextlevelbuilder/ui-ux-pro-max-skill，skills.sh约41万安装、GitHub约14万stars；从上游临时只读副本加载Web/React指导，本地副本是React Native定制版，不修改全局skill。

截图发现：未选择会话时右侧空白占大半屏，列表仅380px；正文和标尺8–10px；活动格低对比；手机热图被横向裁切。另代码核实父行聚合子会话活动，却定位父正文。

实施：Sessions样式单独维护，主区域按选择状态分配空间，标题/标签同行、正文与状态字号提高；热图显示清晰活动/零/未知，tooltip和键盘值提供时长；每条会话只用自身片段，项目保持并集；窄屏标题下整条热图，拖动时保留时间轴和消息，支持展开阅读；登记输入有可见标签。

验收：完整React与类型/构建检查；Playwright headless在1600、1024、768、375宽度及横屏、reduced-motion检查。使用合成对话，真实内容不进入截图；保持搜索浮层、拖动锁行、取消过期请求和Scheduled边界。旧数据、后端契约不变，不提交/发布。

证据目录：/tmp/.vdr-log/2026-10-24-session-ux-refinement。设计检索的营销站Pattern与此工具不匹配，不采用该结构；仅采用匹配的Data-Dense Dashboard、热图及dragging/keyboard指导，延用现有本地字体和主题tokens。
