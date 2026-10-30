# Rillo

<img src="ui/assets/rillo.png" alt="Rillo 吉祥物刺刺" width="96" height="96">

Rillo 是运行在本机的 coding-agent 会话与自动化控制台。Sessions 直接浏览 CLI 保存的会话，按 workspace、分支和时间查找对话，以主子会话树和消息热力时间轴展示，支持侧边 sheet 阅读。侧栏支持 Workspace / Branch 分组，同名分支可以汇总多个项目的会话。每条会话及阅读面板提供 Pin 按钮；顶部 Pinned 入口集中查看待继续的会话，保留目录和分支筛选。Pin 独立于运行状态，关闭或恢复会话不会清除，完成后手动取消。

它还支持由 Markdown 定义 Scheduled Task。到期后，常驻的 `daemon` 直接调用本机 code-agent CLI，并把 session ID、结果、文件变更和日志引用写入统一 Run ledger；对话正文仍由本机 agent CLI 持有。

当前状态：

- 支持 macOS 和具有 systemd 用户服务的 Linux；React Dashboard 可用；Legacy bundle 仅作为回滚资产保留，不是 production entry；
- Codex 和 Claude Code 插件提供会话查询、关系登记、消息发送与控制工具；Sessions 正文浏览当前支持 Codex；
- Scheduled Task runtime 支持 Codex 和 OpenCode；
- Sessions 支持按项目目录浏览 Codex 会话、按活跃时间排列和搜索正文；macOS 可一键打开终端，Linux 复制 Session ID 后自行恢复；
- runtime registry 已按 multi-CLI contract 设计，后续 runtime 只增加 adapter，不增加第二套调度链路；
- 所有数据都保存在本机，不需要 cloud account 或 auth token。

Rillo 0.15.0 使用 `rillo` 命令、插件标识和发布资产名称，GitHub 仓库为 `joisun/rillo`。旧版本的配置、定时任务和执行记录由安装脚本迁移，详见[更名与安装迁移](docs/migrations/rillo-rename.md)。

## Quick start

要求 macOS 或提供 systemd 用户服务的 Linux、Node.js 24+、`curl`、`tar`，以及 `sha256sum` 或 `shasum`。

安装 latest GitHub Release：

```bash
curl -fsSL https://raw.githubusercontent.com/joisun/rillo/main/install.sh | bash
```

安装完成后打开 Dashboard，或检查服务：

```bash
rillo open
rillo status
```

普通安装不需要 clone repository、`npm install` 或 `npm ci`。更谨慎的固定版本安装方式：

```bash
version=v0.15.0
curl -fsSLO "https://raw.githubusercontent.com/joisun/rillo/${version}/install.sh"
less install.sh
bash install.sh --version "$version"
```

installer 会在解包前验证 Release 中的 `SHA256SUMS`，但不会探测、登录或配置任何 agent CLI。CLI availability 由运行时 registry 统一解析。

## Linux Web service

Linux 使用 `systemd --user` 管理一个 `rillo.service`，安装、启停、状态和卸载沿用相同的 `rillo` 命令，不需要 root。安装时需要可用的用户级 systemd manager；installer 不修改系统服务或用户 lingering 策略。退出登录后是否继续运行取决于该机器的用户 manager 配置。

Linux 安装需要 Release 包含 `rillo-linux.tar.gz`；macOS 使用 `rillo-macos.tar.gz`。两个包均为自包含的 JavaScript runtime 与预构建 Dashboard，不捆绑 Node.js。安装后无需 `npm install`。Linux 日志位于 `~/.local/state/rillo/`，用户 unit 位于 `~/.config/systemd/user/rillo.service`。

默认服务仅监听服务器的 `127.0.0.1`。需要直接从网络访问时，在服务器的 `~/.config/rillo/config.json` 中配置以下字段，再执行 `rillo stop` 和 `rillo start`。以下配置允许通过服务器 IP 或已指向该服务的域名访问：

```json
{
  "output_dir": ".",
  "server_listen_host": "0.0.0.0",
  "server_port": 43127
}
```

浏览器打开服务器地址，例如 `http://10.10.20.62:43127/`。页面、API 和 SSE 均由 Rillo 原生提供，无需反向代理。服务不按客户端 IP、Host 或 Origin 拦截请求；`server_public_url` 可选，仅设置 CLI 展示和打开的地址，旧 `server_allowed_clients` 字段不再生效。本机 CLI/MCP 和健康检查继续使用 `127.0.0.1`。默认安装仍只监听本机；通过本地代理访问 `http://rillo.local/` 时，无需配置该域名白名单。

也可保留默认本机监听，并使用 SSH 转发（以下为默认端口示例，替换登录地址）：

```bash
ssh -N -L 43127:127.0.0.1:43127 user@server
```

随后在该电脑打开 `http://127.0.0.1:43127/?view=sessions`。Linux 上的 `rillo open` 输出访问地址，不启动服务器上的桌面应用。

会话树、正文、搜索、关系与 Scheduled 均通过 Web 使用。点击对话标题右侧的复制按钮取得 Session ID，然后在服务器上的对应 workspace 与相同 `CODEX_HOME` 下执行：

```bash
codex resume <session-id>
```

Linux 不提供启动终端、tmux 或系统应用打开产出文件的功能；Session ID 复制保留，相关桌面操作不在页面提供。服务卸载保留配置、Schedule、运行记录与日志。

## Connect an agent

Service 与 agent adapter 独立安装。只安装你实际使用的 adapter。

### Codex

```bash
codex plugin marketplace add joisun/rillo
codex plugin add rillo@rillo
```

安装或更新后新开一个 conversation，使 MCP 工具生效。插件不再安装生命周期记录 hooks。

### Claude Code

```bash
claude plugin marketplace add joisun/rillo
claude plugin install rillo@rillo
```

按 Claude Code 的提示 reload plugin；若出现 MCP approval，只批准 plugin cache 内的 `dist/mcp-server.mjs`。

两个 adapter 分别维护 manifest、MCP config 与 bundle，只共享 localhost HTTP contract：

```text
adapters/
├── codex/rillo/
└── claude/rillo/
```

## How it works

Rillo 只有一个长期运行的 service 和一个写入边界：

```text
Sessions
CLI-owned sessions ◀──adapter── daemon ──HTTP──▶ Dashboard
                                  │
MCP session_link ──HTTP──────────▶ │──▶ session-links.sqlite

Automation
Schedule.md ──watch──▶ daemon Scheduler ──▶ Runtime Registry
                          │                       │
                          │                       └──▶ codex app-server
                          │                                  │
                          └──▶ scheduler.sqlite ◀── events / result / session
                                      │
                                      └── SSE ──▶ Dashboard
```

macOS 使用 `launchd`，Linux 使用 `systemd --user`，两者都只负责让同一个 `daemon` 常驻。每个 Schedule 不再创建 LaunchAgent，也没有独立 runner、Unix socket、claim、heartbeat 或 completion spool。

### Session ownership

会话标题、正文、时间、workspace 和原生关系由 CLI 维护，按需读取，不复制成 Task。外部协作关系单独保存在 `session-links.sqlite`；旧 Tasks 数据库、生成文件与 spool 保留原样，服务启动不再读取、迁移或重放它们。

### Scheduled Run model

手动 `Run now` 与到期触发都进入同一个 `RunService.create()`：

```text
queued → running → succeeded | failed | timed_out | canceled | interrupted
```

流程只有一条：

1. 读取 Markdown definition，并生成 immutable execution snapshot；
2. 先在 `scheduler.sqlite` 创建 durable `queued` Run；
3. daemon 创建一个共享 Runtime Environment，从显式 override、process `PATH`、Homebrew、fnm/nvm/mise 等 user toolchain 与 platform candidates 中解析 executable；
4. runtime status、model discovery 和 Run 都复用该环境；`daemon` 使用 argv array、`shell: false` 和同源 child `PATH` 直接启动 CLI；
5. Codex active Run 使用独立的 `codex app-server --listen stdio://`；runtime adapter 把 protocol notification 转为统一、bounded event；
6. `RunService` 在执行边界同时做 bounded、in-memory Workspace snapshot，与 runtime file-change evidence 合并；这样 nested tool 写文件但 app-server 未发 `fileChange` item 时也不会漏掉产出；
7. Run ledger 保存 terminal state、session ID、final message、Workspace-relative file changes 与 bounded log path；
8. Dashboard 通过 Run-specific SSE 更新；active Turn 可以追加指令或停止；terminal Run 的历史对话由 runtime adapter 使用可信 Run ID 和 session ID 从 CLI-owned session 按需读取；
9. 需要继续工作时，terminal Run 可以从可信 snapshot 召回 session。

点击 Run「产出文件」中的文件名，会在浏览器新标签页访问由 rillo 提供的临时文件预览，macOS 和 Linux 均支持，也可从另一台电脑访问服务器产物。HTML 可直接运行，并加载产物所在目录内的相对 CSS、JS、图片和数据资源；未识别的入口文件类型按下载处理。macOS 另保留「系统打开」，使用服务所在机器的默认应用打开文件。

预览入口必须是该 Run 在 workspace 内记录的、仍存在的普通文件，临时链接有效期30分钟；过期或服务重启后，从运行记录重新点击文件名即可。资源限定在入口文件所在目录，不提供目录列表，拒绝隐藏文件、目录越界和符号链接逃逸；以 `/` 开头的站点根路径不会自动改写，需要产物使用目录内的相对资源路径。HTML 使用独立的沙箱来源，允许脚本交互，不授予 Dashboard 的存储或 API 权限。预览实时读取磁盘文件，不保存产物副本；同名文件被后续任务更新后，旧 Run 的入口也会读取更新后的内容。已删除的文件不可点击，文件缺失或过期会显示原因。

一个 runtime 不可用不会让 Recorder 或其他 runtime 下线。登录或 provider 错误由实际 Run 记录为 typed failure，不会阻塞 service 启动与 runtime 列表加载。

### Live Session control

打开一个正在运行的 Codex Run，Run Review 会显示 Live Session：assistant message delta 与安全的 activity 摘要按发生顺序更新。输入追加指令后，Dashboard 只提交 Run ID、`expected_turn_revision` 和最多 16 KiB 的 text；`daemon` 使用私有 `turnId` 调用 `turn/steer`。Stop 同样只提交 Run ID 与 revision，并映射到 `turn/interrupt`。

Live Session 断线后自动重连，也可点击“重新连接”；连接恢复会补读任务状态，避免错过结束事件。最近 500 条实时消息保留在窗口内，发送期间继续输入的文字不会被清空。Scheduled 列表、执行历史和详情会随服务端事件更新，连接恢复后会同步补读。

Live Session 只干预当前 active Turn，不在 Dashboard 内创建第二轮对话。Run 结束后，页面会重新读取 authoritative terminal Run，并通过 Codex 原生分页接口从本机 Codex-owned session 临时取得 user/assistant messages（旧 CLI 回退为有容量上限的 `thread/read`）；Rillo 不复制或持久化这份 transcript。已结束 Run 可点击 Session ID 在 Terminal 中恢复并继续对话；Session ID 在创建时立即保存，超时、取消、连接异常或服务重启后仍可恢复已创建的会话。历史对话读取失败时可点击“重新读取”。

实时 message、guidance、reasoning 与 tool payload 不写入 SQLite 或普通日志。OpenCode Run 的受限 stdout/stderr 会记录服务诊断、工具标题或脱敏命令摘要，不记录工具参数和输出正文。历史读取只向通过访问检查的 browser 返回可展示的 `userMessage` / `agentMessage`，不返回 reasoning、tool arguments/results 或 command output；本机 Codex session 被删除后，页面明确回退到 Run `final_message`。Run ledger 只保留既有 terminal facts；browser 不接触 runtime `turnId`、executable、argv 或 shell command。Run SSE 是 bounded memory replay，缓冲过期时页面明确 reset，并仍可读取 terminal facts。

## Sessions

点击 Dashboard 顶部的 **Sessions**，或打开 `/?view=sessions`。左侧按原始 workspace 目录筛选，中间以会话树按最近活跃时间排列，点击会话或操作热力条后在右侧 sheet 阅读用户消息与助手回答。输入关键词后，正文搜索结果在输入框下方浮层展开；点击结果或用方向键和 Enter 选择后定位首处命中，Escape 关闭浮层。搜索不替换中间的会话时间线。

当前接入 Codex 的本机会话，读取 `CODEX_HOME`（默认 `~/.codex`）对应的数据源，通过 `codex app-server` 查询，不要求存在 Task 或 Run。根查询包含 CLI、VS Code、App Server 和 exec 来源的未归档会话；页面仅保留 Tree，在会话接近视口时自动读取原生 subagent 与登记的协作子会话。一级节点只展示主会话，子会话只能挂在父级下；父级不在当前页时按完整引用补读祖先，无法读取父级的子会话不会升为一级节点。原生标记为 subagent 但没有父级信息的会话也不会独立展示。选中已读取的子会话时自动展开对应祖先，手动折叠不改变父子关系。目录、会话、正文搜索和较早消息均在滚动接近边缘时自动分页；目录数量仅表示已发现数量。

每个会话条目固定为标题、subtitle、热力条三层，以细边框和间距区分条目。状态圆点位于标题前，子会话类型、关系数量、fork 来源和终端继续操作均在标题行；subtitle 只展示完整 workspace 路径与靠右的分支名。每条会话显示自己的矩形热力条，范围从创建时间到最后一条用户或助手消息。起止时间显示在右侧对话标题下方，与热力条共用创建时间和最后一条用户或助手消息时间，不使用会话更新时间代替。每个逻辑格为一秒，颜色深度表示该秒消息数；长会话多个秒格落入同一物理像素时，以最高每秒密度着色。鼠标移动按动画帧定位实际消息，不必等鼠标停下；目标已在当前正文页中时直接滚动，同一消息内移动不重复请求。未读消息合并到最新目标，当前读取完成后再查询，避免连续移动反复取消请求。平滑滚动约100ms，途中可以转向或被手动操作打断；方向键切换相邻消息，Home/End跳到首尾，触屏可点击或滑动。阅读时竖线游标、时间提示和底部三角同步到正文位置，离开悬停预览后回到阅读位置；滚动本身不发起定位请求。手动滚动暂时保留阅读位置，再次操作热力条或点击“最近消息”自动恢复跟随；减少动态效果设置下立即定位。


消息时间优先使用Codex原生分页接口的完成时间，再用开始时间。部分旧会话接口返回空时间时，按消息ID或同一轮次内唯一对应的文本，从同一数据源原始日志补回时间；仅保留有界时间元数据，不保存正文。热力图和子会话读取共用最多4个并发位置，后台预读最多占3个，用户定位优先，离屏取消预读并暂停翻页。未读区域不伪装为零，没有手动补读按钮或阴影说明。子树短暂缓存，确有子会话才显示展开按钮。来源、目录、分支目录或主列表读取失败时，在整个Sessions区域显示错误并自动重试；单条会话正文、时间线、子会话、关系或搜索失败仅在对应位置提示，不触发整页重连。

侧栏顶部可切换 Workspace / Branch。两者都展示两级目录树：Workspace 为完整项目路径→分支，Branch 为完整分支名→workspace完整路径。选择一级节点查看该目录或分支的全部会话，选择二级节点则同时限定workspace与branch；会话树及正文搜索共享筛选。切换分组保留筛选、搜索与当前对话，并展开选中节点；展开箭头只控制折叠。未知分支的会话保留在workspace一级，不推断为main。不同项目中的同名分支（包括 main）会合并展示。分组选择保存在 URL 的 group 参数与本机偏好中；窄屏通过顶部选择器切换。分支目录按原生索引继续翻页，计数为已观测会话数，不代表完整历史总数。

目录、分支与会话列表共用100条原生索引结果，不在每次打开页面时扫描所有日志。元数据使用最多64页、有效期30秒的进程内缓存，3秒后先返回已有结果再刷新；搜索与正文不进入这份缓存。日志修复使用独立后台连接，正常最多每5分钟核验一次；原生索引为空时先核验历史，核验失败显示错误。文件变化和原生通知触发更新，页面可见时每15秒补查。已读完的热力时间点仅在验证日志历史未变后复用，撤回、重写或无法验证时重新读取。

会话状态通过现有 Codex 共享 app-server 的 Unix socket 读取，不再扫描进程或打开的日志文件。中栏顶部显示 Needs you（等待审批、输入或主会话错误）、Working（执行中）、Ready（已加载且空闲）、Inactive（未加载或子会话失败）。点击一种状态将其优先排列，再次点击恢复最近消息排序，并保留父子层级。计数为当前筛选范围内已载入且可在树中展示的会话，不代表完整历史总数。行内圆点的颜色对应状态，目录绿点表示其中有正在执行或等待用户操作的会话。状态事件触发刷新，并每5秒补查；共享服务器不可用时显示“状态不可用”，历史对话仍可读取。

状态范围仅限所连接的共享服务器；独立 CLI、其他数据目录或 Desktop 私有实例中的运行状态可能不在其中。Inactive 表示该共享服务器未加载，不代表系统中没有其他进程使用它。查询不会启动、恢复或接管会话，也不会为获取状态自动启动共享服务器。

协作子会话与原生 subagent 形成层级。标题行提供父会话跳转、子会话数量与选择浮层；已读取的关联会话显示标题，未读取的引用显示短 ID，点击后按完整 provider/store/session 引用读取。Fork 作为独立主会话，标题行显示 `forked from xxx`；Codex 原生创建时间已知时显示 `forked from xxx at xxxx`，这是新 fork 会话的创建时间，不是来源消息的截断时间。派生 Fork 入口支持从来源跳到已发现的派生会话，数量会随分页补充。Fork 不作为协作父子，也不通过项目、分支、标题或时间相近推断关系；复制的早期历史不计入新会话热量。

### Register collaboration links

插件暴露以下 MCP 工具，共用 Dashboard 的 HTTP API v5 和原生数据来源：

| 工具 | 用途 |
| --- | --- |
| `runtime_list` | 查询已配置的 agent runtime 及可用性 |
| `schedule_list`、`schedule_get` | 列出定时任务，读取完整定义、Prompt 和 `etag` |
| `schedule_create`、`schedule_update`、`schedule_delete` | 创建、按字段修改、将定义移入 `.trash`，保留执行记录 |
| `schedule_pause`、`schedule_resume` | 暂停或启用后续调度，不停止已经开始的执行 |
| `schedule_run`、`schedule_runs`、`run_read` | 立即执行、查询最近执行记录、查看状态和可选对话 |
| `session_sources` | 查询会话 provider 与准确的 `store_id` |
| `session_list`、`session_search` | 按 workspace、branch 分页查询，搜索用户和助手正文 |
| `session_read`、`session_messages` | 读取会话元数据、分页正文，可在单个会话中搜索或按时间定位 |
| `session_children`、`session_relations` | 查询子会话及委派、subagent、fork 关系 |
| `session_link`、`session_unlink` | 登记或解除手动委派关系 |
| `session_control_sources`、`session_control_capabilities` | 查询消息数据源、通道优先级和目标当前轮次 |
| `session_send`、`session_interrupt`、`session_delivery` | 排队、执行中追加、打断、打断后发送及查询投递回执 |

修改、删除、启停需传入 `schedule_get` 返回的最新 `etag`，字段名为 `expected_etag`。发生 `SCHEDULE_VERSION_CONFLICT` 后重新读取并核对修改，工具不会自动覆盖。`schedule_create` 创建启用状态的任务，默认只读 sandbox、禁用 skills 和 integrations；`cadence` 支持 once、interval、hourly、daily、weekly、monthly，interval 的 minutes 为 1–1440 的整数，周期 cadence 可设置 work_hours（weekdays 与多个 start/end windows），周期时间使用服务所在机器的时区，weekly 的 weekdays 为周一 1 至周日 7。workspace 必须是服务器上存在的绝对路径。

例如，每天 09:00 执行：

```json
{
  "title": "每日项目检查",
  "prompt": "检查项目变化并生成报告。",
  "workspace": "/srv/project",
  "agent": "codex",
  "cadence": { "kind": "daily", "hour": 9, "minute": 0 }
}
```

`schedule_run` 必须传入 `idempotency_key`，重试同一次执行时复用该值。创建任务本身不支持幂等重试，响应丢失后先查询任务，避免重复创建。`schedule_runs` 默认返回最近 20 条，最多 100 条，`truncated` 表示还有更多记录。会话查询与搜索返回 `next_cursor`，有游标的空搜索页不代表查无结果；继续使用相同筛选与下一页游标。`session_messages` 的 `query` 与时间定位 `at` 不能同时使用。

`session_messages` 还支持 `mode`：

| mode | 行为 |
| --- | --- |
| `page`（默认） | 沿用原生分页，使用 `limit`、`cursor`，可搜索 `query` 或定位 `at` |
| `head` | 从开头取 `count` 条消息，默认 20，最多 1000 |
| `tail` | 从结尾取 `count` 条消息，默认 20，最多 1000 |
| `all` | 从开头自动翻页，读取整个会话的用户和助手消息 |

head、tail、all 返回的每批消息均按时间正序排列，不包括工具执行记录与 reasoning。它们不能与 `limit`、`query`、`at` 混用。head/all 直接使用原生正向分页，无需扫描最近历史才能取得第一条。tail 的继续游标指向更早的消息；head/all 的继续游标指向更晚的消息。继续读取时传相同 mode、完整 SessionRef 及返回的 cursor，不要将历史游标用于 page。

例如，读取会话最后 10 条消息：

```json
{
  "provider": "codex",
  "store_id": "session_sources 返回的 store_id",
  "session_id": "实际 thread.id",
  "mode": "tail",
  "count": 10
}
```

将 mode 改为 head 可读开头 10 条；改为 all 并去掉 count 可自动读取完整历史。单次历史读取最多 50 页、25 秒，`max_chars` 默认 200000，可设为 1000 至 1000000。到达上限会返回 `truncated: true` 和 `next_cursor`，继续读取不会跳过页内剩余消息。若单条消息超过预算，返回空消息数组和 `required_chars`，增大 max_chars 后用原游标重试。`complete: true` 只表示已经到达整个历史边界且内容没有截断；head/tail 满足条数但还有历史时，complete 仍为 false。原生展示接口的长消息文本最多 16 KiB，截断会如实标记，不能将此时的 all 结果称为完整原文。旧服务不支持正向读取时明确报错，需要同时更新服务与插件。


每个端点使用完整引用 `{ provider, store_id, session_id }`；Codex 的 session_id 必须是具体 `thread.id`，不能用 fork 共享的 root sessionId。

例如，先查询来源，再将实际创建的子会话登记到主会话下（以下为假设引用）：

```json
{
  "parent": { "provider": "codex", "store_id": "configured-store", "session_id": "main-thread" },
  "child": { "provider": "codex", "store_id": "configured-store", "session_id": "child-thread" },
  "source": "otty"
}
```

重复登记同一关系不会重复写入；自关联、反向或间接循环、给已有父级的子会话指定另一个父级都会被拒绝。需要纠正时显式解除旧登记，再登记新关系。原生 subagent/fork 关系只读。来源不支持读取或身份尚未确认时应报告未登记，继续终端工作；不能猜 ID、改写 transcript 或建立补传队列。

Sessions与Scheduled共用零外边距、无外框的根布局，切换时不改变头部高度和内容起点。Sessions / Scheduled、Workspace / Branch 使用中性色圆角分段按钮；会话区域不再提供 List / Tree 切换。桌面侧栏宽350px，初次进入时 sheet 收起，会话树使用剩余空间；打开 sheet 会压缩会话树，收起后恢复宽度并保留选中会话和阅读位置。sheet 为非模态面板，打开后仍可操作会话树；1100px及以下隐藏侧栏并提供目录选择器，680px及以下打开 sheet 时使用全宽阅读，收起后回到树。普通阅读默认滚到最近内容，自动补读更早历史时保留消息位置。正文12px，头部保留标题与终端继续、复制、收起等操作；关系管理放在浮层中。会话标题单行省略，目录显示完整路径，过长时从开头省略并可悬停查看全文。每行的终端继续按钮始终可见，点击不改变预览。

正文搜索优先直接读取Codex的JSONL文件，不建全文索引。服务先从原生接口取得符合workspace、branch和来源限制的会话，再用ripgrep搜索用户消息与助手回答；工具输出、reasoning和图片数据不参与匹配，也不以preview代替正文。每个文件只提取首处命中的短节选，不复制或持久化正文。首次请求最多搜索最近16条候选会话并立即返回；页面保留已命中结果，自动分批搜索较早会话，每批最多200条，不需要滚动触发。空批次也继续搜索，完成前不会显示“没有找到匹配的会话”。优先使用Codex自带的rg，也会查找系统PATH及常见工具安装目录；缺少rg或遇到非普通JSONL记录时，继续使用Codex原生正文搜索。命中定位仍使用原生实验接口，已在Codex CLI 0.164.0验证；旧版本缺少能力时明确提示更新，不降级为只搜索preview。改词会取消旧搜索并停止其进程；搜索总时限60秒，失败仅影响搜索浮层，不中断列表和对话。

macOS 点击 **在终端继续**，使用右上角设置中的恢复终端。Linux 保留复制 Session ID，自行在服务器终端恢复。恢复目录和 Session ID 由服务重新读取；浏览器不能指定命令。Claude Code 会话浏览尚未接入，现有 Claude Recorder adapter 不等同于 Sessions provider。

## Scheduled Tasks

Schedule definition 是 source of truth；SQLite 只记录 Run facts。默认目录为 `~/.config/rillo/schedules`。

```markdown
---
type: rillo/schedule
id: 8b4a8b25-3d1e-4e43-8f5f-9cbef95b9275
title: Daily repository review
enabled: true
workspace: /Users/me/projects/example
agent: codex
schedule:
  kind: daily
  at: "09:30"
capabilities:
  skills: disabled
  integrations: disabled
sandbox: read-only
model: null
reasoning: null
timeout: 2h
---

Review the repository health and summarize actionable risks.
```

`capabilities` 控制 Codex 启动时进入 Agent context 的扩展能力：

- `skills: disabled` 禁用当前 Run 的 Skill discovery、Skill search 与 Skill MCP dependency install；
- `integrations: disabled` 禁用当前 Run 的 MCP servers、plugin MCP 与 Apps/Connectors；
- 每项也可设为 `inherit`，沿用本机 Codex 配置；
- Web Search 与 Codex core tools 不属于 `integrations`，不会被该开关关闭；文件和网络权限仍由 `sandbox` 独立控制。

Dashboard 新建的 Codex Schedule 默认使用 `disabled / disabled`，以获得最小、可预测的自动化上下文。已有 Markdown 未声明 `capabilities` 时保持兼容，按 `inherit / inherit` 读取。每个 Run 会把 policy 写入 immutable execution snapshot；执行期间不会改写全局 Codex 配置，也不需要重启 `daemon`。

支持 `once`、`interval`、`hourly`、`daily`、`weekly` 与 `monthly` cadence。Dashboard 的 Create/Edit/Pause/Resume 会 atomic rewrite Markdown，并用 SHA-256 `etag` 做 compare-and-set；Delete 把 definition 移到 `.trash/`。行级一次性 Run action 在执行期间会切换为 Stop；它与只控制周期调度的 Schedule pause/resume 是两套独立操作。

### 分钟间隔与工作时段

创建和编辑计划时，选择“每隔 N 分钟”可设置 1–1440 分钟的整数间隔，例如每 10 分钟采集一次。开启“工作时段”后，可自行选择星期并增删多个时段，不限制为固定的上下班时间。以下是 Markdown 中的 `schedule` 配置片段：

```yaml
schedule:
  kind: interval
  minutes: 10
  work_hours:
    weekdays: [1, 2, 3, 4, 5]
    windows:
      - start: "09:00"
        end: "12:00"
      - start: "13:30"
        end: "18:00"
```

星期按周一 1 至周日 7；所有时间使用服务所在机器的时区。窗口包含开始、不包含结束，结束可填 `24:00`；窗口须在同一天内且不能重叠。示例会在 09:00、09:10…11:50、13:30、13:40…17:50 到期，下班、午休和周末不启动。

配置工作时段的间隔任务，每个时段从其起点重新计时；没有时段限制的 interval 使用固定经过分钟的时间网格，跨小时保持间隔。服务重启或从休眠恢复时，只合并补跑当前开放时段内最近的一次，不重放午休前、昨天下班前等已关闭时段。正在执行的任务继续完成，手动“立即运行”不受工作时段限制。

工作时段也可限制 hourly、daily、weekly、monthly；固定执行时间必须落入至少一个时段，每周日期也须与工作星期有交集。一次性计划不使用工作时段。未配置 work_hours 的现有任务保持原行为，无需重写旧 Markdown 或迁移数据库。


Front matter 可选填 `session_id`，作为关联会话的元数据。值会去除首尾空白，须为 1–128 字符的字符串；省略或填 `null` 表示未设置。编辑、暂停或恢复计划时会保留该字段。每次 Run 仍创建新会话，实际运行产生的 Session ID 由 runtime 返回。

Codex Schedule 支持 `fast_mode: true`（开启 Fast mode）、`false`（明确使用普通速度）；省略或 `null` 表示跟随 Codex 默认配置。Dashboard 的 Fast mode 选项与此对应。配置随 Run 快照保存，修改 Schedule 不会改变已创建的 Run。该选项仅适用于 Codex，实际可用性及用量规则由所选模型和账号决定。

Codex 的 `workspace-write` 只表示文件写入权限，不等于允许联网。联网采集任务可显式设置 `network_access: true`；`false` 禁止网络，省略/null 继承 Codex 默认。该字段只控制 workspace-write 下的 shell 网络访问，独立于 Fast mode、Web Search 和 MCP 设置；后台审批策略为 `never`，不会弹出额外授权。Dashboard 的“沙箱网络访问”与此对应，选择随 Run 快照保存，不修改全局 Codex 配置。完整采集、编稿、构建与浏览器检查应设置足够的 `timeout`（例如 `2h`），超时仍会终止运行。


### Codex 临时错误重试

Codex 定时 Run 遇到模型容量不足、临时限流、模型连接失败或 5xx 服务错误时，在原会话中最多自动重试 3 次。等待时间依次为 10、30、90 秒，并增加最多 20% 随机延迟。重试使用同一个 Run 和 Session，不切换模型，不重建调度记录；恢复提示要求核对已有结果，只完成未完成的工作。

等待期间 Run 保持 running，实时活动显示重试次数与等待时间，stderr 日志记录原因。任务原有 timeout_seconds 覆盖所有尝试和等待，不因重试延长。点击停止、取消任务或关闭服务会清理等待，不再启动后续尝试。

只在 Codex 明确报告轮次失败后重试。鉴权、余额或用量耗尽、参数和权限错误不重试；工具执行结果尚未确认、进程退出或控制连接断开时，不自动重放任务。达到上限后保留原生错误说明，容量不足返回 RUNTIME_MODEL_AT_CAPACITY，临时限流返回 RUNTIME_RATE_LIMITED，其余 provider 错误返回 RUNTIME_PROVIDER_ERROR。

该机制用于 Codex 定时执行器；OpenCode 继续使用其原生重试行为。已有失败的 Run 不会被自动重新执行。

### OpenCode 定时执行器

安装并配置本机 OpenCode 后，Editor 可选择 `OpenCode`。可通过 `OPENCODE_BIN` 指定可执行文件；模型使用 `provider/model`（例如 `openai/gpt-5.4`），Variant 对应 OpenCode 模型变体，留空继承本机默认设置。模型目录仅显示已连接 provider 的模型。

OpenCode Run 使用独立、带随机认证密码的 loopback `opencode serve`，通过 HTTP 与 SSE 执行任务和推送文本、工具状态。支持到期执行、Run now、追加指令、停止、超时、历史对话，以及 `opencode --session` 终端恢复。OpenCode 服务诊断写入 stderr；工具标题或脱敏命令摘要写入 stdout；模型错误会保留 provider 返回的可读详情。取消时调用原生 session abort，再结束本次 Run 自己启动的服务，不影响已有 OpenCode 服务。

OpenCode 不提供 Codex 的操作系统沙箱，首版必须使用 `sandbox: danger-full-access`，并显式继承 `capabilities: { skills: inherit, integrations: inherit }`。Editor 会展示并要求确认这一权限范围。`fast_mode` 与 `network_access` 不适用于 OpenCode；工具权限仍由本机 OpenCode 配置控制。收到权限询问或交互问题时，任务分别以 `RUNTIME_PERMISSION_REQUIRED` / `RUNTIME_INPUT_REQUIRED` 结束，保留 Session 以便人工继续，不会在后台无限等待。

历史读取最多最近 100 条原生消息、1 MiB 可展示文本，仅包含 user/assistant 文本。OpenCode 自己管理会话持久化；Rillo 不保存第二份完整对话。本适配仅增加定时任务执行器，不包含 OpenCode 工作记录插件。


filesystem watcher 提供低延迟刷新，周期性 rescan 保证最终收敛。修改 Definitions directory 时，现有 definitions 会在同一个操作中安全迁移并切换 watcher，不需要重启 `daemon`。

Runtime 与 model 由以下 API 动态获取：

```text
GET  /api/v1/runtimes
POST /api/v1/runtimes/refresh
GET  /api/v1/runtimes/:id/models
```

当前 Codex adapter 使用同一个解析结果执行 `codex --version`、`codex debug models` 与真实 Run。model probe 失败时 Editor 显示 adapter-owned fallback，而不是无限 loading 或让 route 消失。

## Data and configuration

```text
~/.local/share/rillo/
├── current -> releases/<version>
└── releases/<version>/                 # immutable program files

~/.local/bin/rillo             # management CLI

~/.config/rillo/
├── config.json
├── session-links.sqlite                # explicit collaboration links only
├── scheduler.sqlite                    # unified Run ledger
├── schedules/
│   ├── *.md                            # Schedule source of truth
│   ├── .trash/                         # recoverable delete/migration backup
│   └── logs/                           # bounded per-Run stdout/stderr
└── logs/rillo.ndjson           # privacy-bounded service log

~/Library/Logs/rillo/
├── daemon.stdout.log
└── daemon.stderr.log
```

会话关系数据库是 `~/.config/rillo/session-links.sqlite`；Scheduled Run ledger 是 `~/.config/rillo/scheduler.sqlite`。历史 `tasks.sqlite` 与生成文件继续保留，但不再作为运行时数据源。

默认配置：

```json
{
  "output_dir": ".",
  "resume_terminal": "terminal",
  "schedule_definitions_dir": "schedules",
  "server_host": "127.0.0.1",
  "server_port": 43127
}
```

`codex_path` 是可选的用户 override，不是 capability flag。未配置时 registry 从 `CODEX_BIN`、process `PATH`、Homebrew、fnm/nvm/mise 等常见 user toolchain 和受支持的 platform candidates 中解析 executable；只有通过 executable validation 的候选才消耗 bounded version-probe budget。daemon 的单一 Runtime Environment 同时生成 resolver candidates 与 child `PATH`，避免 GUI/launchd 精简 PATH 下出现“能够探测但无法执行”。一次 unavailable 不会进入长期 cache，下一次读取可直接恢复；installer 不写入 `codex_path`。

当前 React Dashboard 右上角的齿轮按钮打开设置弹窗，可选择 Session Resume terminal，选择后自动保存，下次恢复会话时生效。在 Run 详情中点击 Session ID，会使用所选终端恢复该会话；旁边的复制按钮用于复制完整 ID。当前 terminal adapter 支持 Terminal.app、Otty 与 Ghostty；browser 永远不能提交 shell command。Resume 只提交会话引用或可信 Run ID；服务重新读取对应 workspace。Live Session 另可提交 bounded guidance text 与 public Turn revision。

选择 Otty 或 Ghostty 后，服务先聚焦该会话已有的 pane。没有匹配 pane 时，优先在现有窗口新建 tab；没有窗口时才新建窗口并使用初始 tab。连续点击同一会话不会重复启动。Sessions 中正在执行的会话也可点击定位；若找不到对应 pane，服务返回提示，不重复启动会话。Terminal.app 保持打开新窗口的行为。

Otty 使用原生 `agent_session_id` 匹配会话。Ghostty 需要 1.3.0 或以上及 macOS Automation 控制权限，原生接口不提供 agent Session ID。服务记录自己创建的 Ghostty pane，并在恢复前确认它仍存在，因此服务重启后也能定位这些 pane。以前手动打开的 Ghostty pane 无法按 Session ID 自动匹配。

## Compatibility

当前服务使用 API v5，Dashboard 与插件必须一起更新。不再提供 Task 记录、归属、checkpoint、摘要或历史导入。旧 Task HTTP 路由返回 `410 TASKS_RETIRED`，旧客户端不应继续重试；Task import/migrate CLI 已退出运行路径。旧数据库与生成文件保留原样，查阅历史时请使用对应版本程序和独立副本。

## Operations

```bash
rillo open
rillo status
rillo stop
rillo start
rillo scheduler status
```

更新 latest Release：

```bash
curl -fsSL https://raw.githubusercontent.com/joisun/rillo/main/install.sh | bash
```

只卸载 LaunchAgent、保留程序和数据：

```bash
rillo uninstall
```

完整卸载程序但保留 `~/.config/rillo` 数据：

```bash
curl -fsSL https://raw.githubusercontent.com/joisun/rillo/main/install.sh | bash -s -- --uninstall
```

## Troubleshooting

```bash
curl -fsS http://127.0.0.1:43127/health/ready
curl -fsS http://127.0.0.1:43127/api/v1/meta
curl -fsS http://127.0.0.1:43127/api/v1/status
curl -fsS http://127.0.0.1:43127/api/v1/runtimes
tail -n 100 ~/Library/Logs/rillo/daemon.stderr.log
tail -n 100 ~/.config/rillo/logs/rillo.ndjson
```

- `SERVICE_UNAVAILABLE`：先检查 `rillo status` 与 `/health/ready`。
- Dashboard 打不开：检查 `server_port` 是否被占用以及 `daemon.stderr.log`。
- Runtime 为 `unavailable`：运行对应 CLI 的 `--version` 后重新打开 editor 或调用 `POST /api/v1/runtimes/refresh`；失败结果不会被长期缓存。registry 会自动补充 Homebrew、fnm/nvm/mise 等 GUI-missing toolchain directories，也可显式配置 `CODEX_BIN` / `codex_path`。
- Model 使用 fallback：手动运行解析到的 `codex debug models`；fallback 不会阻止保存或 Run。
- Run 失败：在 Run Review 查看 stable error code、退出码、provider 错误详情与 stdout/stderr。模型在地区不可用时显示 `RUNTIME_MODEL_UNAVAILABLE` 和 provider 返回的原文；已有 Session ID 可点击后在 Terminal 继续对话。
- 历史对话不可用：确认对应 `thread_id` 仍存在于本机 Codex session inventory；Rillo 不保存第二份 transcript，因此 session 被 Codex 清理后只显示 Run `final_message`。
- Schedule definition 不可用：按页面给出的 source path 修复 YAML、duplicate UUID、unknown field、cadence 或 symlink 问题；watcher 会自动重试。
- 插件仍显示旧 Task 工具：更新插件后新开 agent conversation。当前不再自动记录 Task 或要求 hooks trust。
- Resume 不可用：Run 必须有本机 session transcript 与有效 Workspace，并且对应 terminal / CLI 仍可用。

## Develop from source

```bash
git clone https://github.com/joisun/rillo.git
cd rillo
npm ci
```

先运行 API v5 的 `daemon`，再启动 source Dashboard：

```bash
npm run dev:ui:react
```

打开 <http://127.0.0.1:43128>。`ui/react` 变化会自动 rebuild/refresh，默认 API 来自 `43127`；后端变更需要重启对应服务。API v5 前端不能代理旧版服务；隔离开发时用 `RILLO_DEV_PORT` 和 `RILLO_DEV_UPSTREAM` 指向独立端口。该页面的 mutation 会修改所连接服务的数据。

发布前验证：

```bash
npm run build
npm run build:adapters
npm run check
npm test
npm run test:ui
```

本地安装 source service：

```bash
npm run daemon -- install
npm run daemon -- status
```

构建 release artifacts：

```bash
npm run package:release
```

打包脚本使用 USTAR，关闭扩展属性与 AppleDouble，排除 `._*` 和 `.DS_Store`，并验证每个压缩包的唯一根目录。服务启动时从自身的 `package.json` 读取版本，`/api/v1/meta.service_version` 应与安装包版本一致。

发布目录备齐 `install.sh` 和 `SHA256SUMS` 后，在目标平台直接验证安装包：

```bash
bash scripts/verify-release-install.sh release "$(node -p 'require("./package.json").version')"
```

验证使用临时 HOME、空任务目录和随机端口，实际执行目录中的安装脚本，再检查 Dashboard、健康接口、SSE 和运行版本；结束后清理临时文件与进程，不注册后台服务。Release workflow 将 macOS 构建的同一批文件交给 Ubuntu 运行此检查，通过后才发布 GitHub Release。

## 向原生会话发送消息

消息控制由 `SessionMessaging → provider adapter → transport` 分层实现。先用 `session_control_sources` 取得准确的 provider/store_id，再用 `session_control_capabilities` 核对会话和当前 `active_turn_id`。消息来源与正文浏览来源分开，Claude 消息控制不表示已经支持 Claude 的全部 Sessions 浏览功能。

```json
{
  "session": { "provider": "codex", "store_id": "来源返回的准确 ID", "session_id": "实际会话 UUID" },
  "request_id": "review-followup-001",
  "mode": "queue",
  "text": "当前工作结束后，检查剩余测试并汇报。"
}
```

以上参数调用 `session_send`。`mode` 支持：

| 模式 | 行为 |
| --- | --- |
| `queue` | 排队输入，不表示已经执行完成 |
| `steer` | 向当前轮次补充文本，必须传 `expected_turn_id` |
| `interrupt` | 先打断指定轮次、确认其结束，再排队新文本，必须传 `expected_turn_id` |

仅停止而不发送，使用 `session_interrupt({session, request_id, expected_turn_id})`。一次操作最多 16000 字符。`request_id` 为 1–128 个字母、数字或 `._:-`，同一 ID 只允许绑定同一目标和内容。

通道按操作排序，只在明确未接受时降级：

| Provider / 操作 | 优先级与边界 |
| --- | --- |
| Codex queue | 现有 app-server 原生队列 → `codex queue` → 已启用的 Otty 队列 |
| Codex steer / stop | 原生 `turn/steer` / `turn/interrupt`；CLI 不支持的动作不会伪装成 queue |
| Claude queue | SDK 受控连接 → stream-json CLI → 已启用的 Otty 队列 |
| Claude steer / stop | SDK 或 stream-json CLI，只控制服务已持有的 worker；不凭 resume 接管外部活跃进程 |

Codex 连接现有共享 app-server，不为控制目标另起 app-server。队列协议启用原生 experimentalApi；CLI 始终传 Session UUID，并固定该数据源的 CODEX_HOME。Claude 恢复空闲会话前核对原生 agent 目录，不能确认运行归属时不另起 worker。SDK 使用 claude_code preset，CLI/SDK 均不添加绕过权限参数；非交互 resume 的权限规则由 Claude CLI 决定。

Otty 仅在 macOS 且 `resume_terminal` 已选择 otty 时作为最后的 queue 通道，按 agent 类型、完整 session_id、workspace 唯一匹配 pane；等待用户回答、多个匹配或 IPC 权限拒绝时不注入文本，不自动开启终端权限，也不盲发 Ctrl-C。终端队列回执只证明终端接受，不证明模型已收到。

发送返回 `delivery`，使用 `session_delivery({request_id})` 查询：

| status | 含义 |
| --- | --- |
| `pending` | 已登记，尚未开始投递；服务重启后可用原参数与 ID 重试 |
| `sending` | 正在向一个通道投递 |
| `accepted` | 指定通道已接受，具体级别见 kind；不是模型执行完成 |
| `rejected` | 明确未完成投递，查看 error 与 attempts |
| `unknown` | 可能已接受，不能换 ID 或通道盲目重发 |

回执保存在 `~/.config/rillo/session-messages.sqlite`，只记录内容指纹、目标、原生消息 ID 与通道尝试，不复制对话正文，也不重建 Codex 队列。服务重启将未确认的在途请求标记 unknown。原生消息 ID 可用于核对队列或最近历史；队列中找不到并不代表未接受，证据不足仍保持 unknown。一次请求串行尝试多个通道；同一会话的不同请求也串行，重复 ID 共用原回执。

Claude 优先依据带原始输入 UUID 的回复流帧或用户回显确认，不把 stdin 写入成功当作原生接受。长时间排队、旧 CLI 不提供对应确认或断线时，回执可能先为 unknown；连接仍在且后续收到匹配确认时，查询回执可核对为 accepted。仅凭队列文本相同不会确认。Claude 必须支持 `agents --json` 的活动目录核对，否则跳过恢复 worker；不会在旧 CLI 上凭猜测启动第二个进程。

`interrupt` 不清空已有队列，新文本遵循 provider 的原生顺序；若已打断但后续投递失败，回执保留 `interrupted_turn_id`。原生 Codex 使用 expectedTurnId；Claude 的 turn ID 表示服务持有 worker 的当前输入，不承诺原生 Codex 同等的跨客户端原子控制。

Claude 受控 worker 随服务关闭，空闲 60 秒释放，最多 8 个；这不改变 accepted 与执行完成的区分。构建固定使用 Anthropic Agent SDK 0.3.312，随包保留其 [LICENSE](server/vendor/CLAUDE_SDK_LICENSE.md)，不捆绑 Claude CLI 可执行文件。

REST 入口为 `/api/v1/session-control/sources`、`capabilities`、`send`、`interrupt` 和 `deliveries/:request_id`，保留 JSON 类型、字段白名单及消息大小校验，不按 Host、Origin 或客户端 IP 拦截。MCP 不接受自定义可执行文件、shell 命令或任意工作目录。

## Security and privacy

- `daemon` 默认只监听 `127.0.0.1`；监听 `0.0.0.0` 时，能连接该端口的客户端均可访问。页面、API、SSE 和开发入口不执行客户端 IP、Host 或 Origin 白名单校验；Dashboard API 不增加跨域 CORS 响应头，浏览器自身的跨域规则仍适用。
- HTTP API 不使用 auth token，也不提供 TLS。网络监听范围由配置及操作系统网络策略决定。
- Runtime invocation 使用明确 executable、argv array、可信 Workspace 和 `shell: false`。
- 除 Scheduled Run 既有的 bounded final_message 外，SQLite 与 Rillo logs 不保存 prompt、reasoning、assistant message、tool output、token 或 transcript 正文；历史对话只从 CLI-owned session 按需读取并在页面内存中展示。
- 不再安装记录 hooks；外部关系登记不可用时不阻塞终端工作，不建立补传队列。
- Installer 在执行 runtime 前验证 artifact checksum，并拒绝 archive path traversal。
- Session Resume 接受原生会话引用，Run Resume 只接受 Run ID；服务重新读取原生数据或 ledger，不接受 browser 提交的 Workspace 或任意 command。

## License

Rillo 采用 [GPL-2.0-only](LICENSE)。默认 Dashboard bundle 使用 React 与 React DOM；随 release 打包的 Legacy 回滚界面使用 SVAR React Gantt。第三方许可见 [ui/THIRD_PARTY_NOTICES.md](ui/THIRD_PARTY_NOTICES.md)；service bundle 见 [server/THIRD_PARTY_NOTICES.md](server/THIRD_PARTY_NOTICES.md)。
