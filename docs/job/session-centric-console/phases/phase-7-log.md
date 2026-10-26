# Cards基础视图（2026-10-25）

用户已授权先提交再实现Cards。性能和热力定位修复提交为f4910d2，24个产品及文档文件，未包含测试；Cards改动仍留在工作树。

## 实现

新增session-cards-view，复用原生sessions及共享选择/预览/终端按钮，按活跃时间自适应排布。Cards首次访问才挂载，随后隐藏保留状态；只有选择改变才调整选中卡片可见性，切换返回不强行滚回旧选择。URL及localStorage增加cards，异常模式仍回退Tree。手机沿用正文返回入口。

自动分页测试暴露空搜索与主列表共用query key：disabled搜索observer可覆盖列表queryFn，导致后续页丢失limit=100参数。查阅TanStack Query官方Query Keys说明后，将sessionSearch与sessionList分开。三种浏览视图仍共享主列表及cursor，搜索保持不持久化。

视觉审阅修复preview被flex撑高、三行省略号后仍露出内容的问题，改为独立高度上限和footer自动间距，摘要折叠空白。另将Tabs分隔符从CSS文本换成图形，避免分隔线计入可访问名称。Context7核对React Aria Tabs/ComboBox；shadcn docs CLI访问失败后读取官方组件文档，项目继续使用现有React Aria组件，没有安装新UI依赖。

## 验收

- 完整UI82/82、Sessions与事件定向45/45、check/build和diff检查通过。本轮不改后端，无需重复Node全量。
- 真实来源100条会话：1次limit=100根列表请求，没有query参数；初始正文、children、timeline请求均为0。点击后正常读正文，List/Cards切换保留同一正文DOM，无页面错误；未截图原生正文。
- 合成32条会话包括超长连续标题、长preview、长分支、active/unavailable。1600/1280/1024/390宽度分别5/3/4/1列，无横向溢出；preview最大59px，关闭/打开正文均可用。
- Cards滚动到1000，切List再返回仍为1000；跨Tree保留正文；较后卡片选中后仍在可见范围。筛选后8条，打开搜索仍8条，选结果按query定位；URL省略sessions参数时仍恢复Cards偏好。
- 键盘焦点有2px轮廓，Enter打开正文；终端成功仅在fixture模拟，不选中或打开正文。空、加载、错误与重试恢复均已检查，错误提示只有1个。
- 视觉记录和Markdown/HTML报告：/tmp/.vdr-log/2026-10-25-session-cards/。154份Markdown已枚举并按受影响行为检索，更新README、architecture和本任务文档。报告校验通过，13条视口/状态覆盖、2项已修复问题及1项待产品判断的内容方向。

## 产品方向

用户认为当前Cards实用性有限。已建议优先展示“最近停在哪”的原生最近一轮对话，再评估协作子会话和fork入口；不推断任务完成状态，不生成额外AI摘要。当前只交付基础视图，内容增强尚未实施。
