# Architecture

本文描述 Rillo 当前必须保持的系统边界。面向用户的安装、使用与排障入口见 [`README.md`](../README.md)。历史 specs 和 job logs 记录决策过程，不代表现行 runtime contract。

## System shape

```text
CLI-owned sessions ◀──adapter── daemon ──HTTP──▶ Dashboard
                                  │
Agent session_link ──HTTP────────▶│──▶ session-links.sqlite
Schedule Markdown ──watch───────▶│──▶ scheduler.sqlite
                                  │
                                  └──▶ Runtime Registry ──▶ local agent CLI
```

macOS `launchd` 与 Linux `systemd --user` 均只管理一个 `daemon` 常驻服务。`daemon` 是唯一 SQLite writer、唯一 HTTP/SSE server、唯一 scheduler 和唯一 Run supervisor。

## Host service lifecycle

`server/control.mjs` 按真实平台选择 macOS LaunchAgent 或 `server/control/systemd.mjs`，Windows 不进入安装路径。Linux controller 写入用户级 `rillo.service`，确认 Node.js 24、用户 manager、端口占用与预构建资产；启用后只重启一次服务。ExecStart 固定为可信 Node 与 daemon 绝对路径，禁用 shell/环境展开，转义 systemd 百分号 specifier 与路径引号。unit 固定 HOME、与 Node executable 一致的 PATH，以及显式 CODEX_HOME，不持久化 API key。日志和 unit 使用用户私有权限。卸载停止并禁用本 unit，删除 unit 后 reload manager；数据和日志保留，不调用 sudo、不改系统 unit 或 lingering。

installer 按 Darwin/Linux 选择不同命名的自包含 archive，校验平台对应的 SHA256 后再切换 current；runtime 本身为同一份跨平台 JavaScript，Node.js 由用户安装。Linux 优先使用 sha256sum，macOS 可使用 shasum。两平台均检查 Node.js 24+、服务配置及预构建入口；健康检查固定走本机地址，展示地址可使用server_public_url。服务卸载失败时不继续删除程序文件。CI 同时运行 macos-latest 和 ubuntu-latest；Release 输出两种 service archive 和原有 adapter archive。

所有archive使用USTAR，显式关闭xattrs与COPYFILE元数据，排除AppleDouble和.DS_Store，生成后检查唯一根目录与元数据条目。installer先对完整列表检查路径越界，再从非元数据条目确定唯一程序根目录；解包继续排除元数据，且根目录必须匹配package.json版本。不得根据压缩包的第一条记录推断根目录。

Release分为macOS构建、Ubuntu安装验证和发布三个job。Ubuntu下载macOS产生的原始archive、installer及SHA256SUMS，在临时HOME中实际安装并直接启动随机端口的daemon，检查版本、Dashboard及SSE，不调用systemd安装。publish依赖Linux验证成功。运行入口server/daemon.mjs读取相邻package.json并注入config.packageVersion，作为/api/v1/meta的service_version；已安装runtime不应返回source。

Linux 按 Web 服务使用，不启动浏览器、桌面终端或 tmux；`rillo open` 仅返回配置的公开访问地址，未配置时返回本机地址。默认可通过 SSH loopback 转发访问，也可显式配置原生网络访问。terminalLauncher.supported=false 时 providers 的 resume=false，settings 返回 local_actions_supported=false。Sessions 不显示终端启动按钮，Scheduled 保留 Session ID 复制并禁用服务器本机文件打开操作，终端选择设置不出现；桌面操作 API 仍返回 typed unsupported。macOS 操作保持原有实现。状态读取通过已有 Codex Unix socket；没有共享服务器时只标记状态不可用，不启动任何 daemon 或使用进程反查。

server_listen_host只接受127.0.0.1或0.0.0.0，省略时沿用server_host；已有server_host保持本机值，旧插件无需理解新增配置。网络模式必须配置server_public_url和非空server_allowed_clients，后者只接受完整IP。serverBaseUrl与RILLO_SERVER_URL保持loopback，供CLI/MCP及controller健康检查使用；serverPublicUrl只用于浏览器地址、允许的Host及同源Origin检查。createApiServer直接提供页面、API和SSE，无第二个代理进程。请求以socket.remoteAddress检查客户端，忽略X-Forwarded-For；本机始终允许，网络客户端必须明确列入配置。Origin必须对应当前Host，未声明的Host、跨Origin及未允许的客户端均返回403。

## Non-negotiable invariants

1. **One daemon**：不得为单个 Schedule 创建 LaunchAgent、长期 runner 或第二个 control plane。
2. **One execution path**：manual 与 scheduled trigger 都调用 `RunService.create()`。
3. **Durable before spawn**：Run 必须先以 `queued` 写入 SQLite，提交后才能解析或启动 runtime。
4. **One Runtime Environment**：daemon 创建一个运行时环境实例，runtime status、model discovery、真实 Run 与 child PATH 都从这里获得 executable context。
5. **File-native definitions**：Schedule Markdown 是 definition source of truth；SQLite 不复制一份可编辑 definition。
6. **Daemon-owned facts**：只有 `daemon` 写 Run state、session、file changes 与 log references。
7. **No browser commands**：browser 只发送 semantic ID 和 typed fields，不能提交 executable、argv 或 shell text；恢复会话所用 Workspace 必须由 daemon 读取。
8. **Failure isolation**：runtime 缺失、model probe 失败或 Scheduler 故障不能让 Sessions 下线；Session provider 失败也不能中断已配置的 Scheduled Run。
9. **Bounded operations**：probe、output、logs、events、shutdown 与 cancellation 都必须有明确上限。
10. **Privacy by construction**：Recorder 不持久化 prompt、reasoning、tool payload、streaming assistant delta 或 transcript content；Scheduled ledger 只保留既有 terminal final message。
11. **Per-Run context policy**：Schedule 的 Skills/integrations policy 必须进入 immutable Run snapshot，并只通过该 Run 的 runtime argv/protocol 生效；不得修改全局 CLI config 或共享 profile。
12. **Native session ownership**：原生会话、正文、时间与原生关系由 CLI 维护。只持久化外部协作关系，不维护第二份 Task 投影或 transcript。
13. **Retired data preservation**：正常启动不导入 Task store/service，不打开、迁移、checkpoint 或修改历史 tasks.sqlite、spool 和生成文件。

## Runtime registry

Registry 保存 immutable runtime definitions，不动态加载用户代码。每个 definition 只描述 runtime-specific behavior：

```js
{
  id,
  displayName,
  launch,
  versionProbe,
  fallbackModels,
  capabilities,
  fetchModels,
  buildInvocation,
  parseEvent,
  createInteractiveSession,
  readConversation,
}
```

Shared infrastructure 负责 executable candidate ordering、canonicalization、version probe、cache、child PATH repair、process supervision、timeout/cancel、Run persistence 和 SSE。只有已 canonicalize 为 executable file 的候选才消耗 bounded probe budget；不存在的 PATH entry 不得遮蔽后面的健康 CLI。Runtime Environment 动态枚举 process PATH、Homebrew、fnm/nvm/mise 等已安装 toolchain，并同时为 resolver 与 child process 生成一致路径。成功解析可 bounded cache；失败解析立即失效，以允许 CLI 安装或环境恢复后的下一次请求自愈。Adapter 不得导入 HTTP、SQLite、cadence 或 UI 模块。

Run store 的 one-active-per-Schedule 约束是 UI action availability 的事实来源：空闲时行级 action 提供一次性 Run now；已有 `running` Run 时同一位置切换为 Stop，并与负责周期调度的 Schedule pause/resume action 使用不同图标和语义。`queued`、`claimed` 等尚不能安全停止的阶段会禁用 Run now；409 只保留为并发安全网，不能成为正常交互反馈。

当前注册 `codex` 和 `opencode`。增加 runtime 的最小范围应是：

1. 新增一个 definition；
2. 新增该 CLI 的 stream parser；
3. 添加 resolver、model、invocation 与 parser tests；
4. 把 definition 加入 composition root；
5. 验证现有 Scheduler、Run store 和 Dashboard 无需 runtime-specific branch。

如果新增 runtime 需要修改 Run lifecycle、再建 daemon、再建数据库或让 browser 构造 command，说明 adapter boundary 设计错误，应先停止扩张。

Registry list 只验证 executable availability，不探测登录态。登录态是易变的 provider execution state；真实 Run 才是权威证据。Model discovery 是独立、bounded、可 fallback 的 capability。

## Run lifecycle

```text
queued
  ├── running
  │     ├── succeeded
  │     ├── failed
  │     ├── timed_out
  │     ├── canceled
  │     └── interrupted
  ├── failed
  └── canceled
```

- `queued` 包含 executable resolution 与 spawn preparation；不存在另一套 dispatch state。
- service restart 把遗留 open Run 收口为 `interrupted`，不自动假设 CLI 仍可安全接管。
- cancel 与 shutdown 必须能打断 resolution 和 child process，不能无限等待第三方 CLI。
- session ID、final message 与 usage 只能来自 normalized runtime events。file changes 优先消费 runtime evidence，并与 `RunService` 执行前后的 bounded Workspace snapshot 合并；snapshot 只在内存保留 metadata，忽略 `.git` / `node_modules`，超出 100,000 files 时 fail open，不阻塞 Run。
- SQLite 只保存最多 128 条已经 containment 检查的 Workspace-relative change paths，不保存 Workspace snapshot 或文件内容。
- log file path 由 daemon 构造；API 不读取 Run ledger 之外的任意 path。

## Active Live Session

Codex 的 active Run 使用 one-process-per-Run `codex app-server --listen stdio://`。这不是第二个 daemon：process lifecycle、timeout、cancel、terminal persistence 与 Run status 仍由 `RunService` 独占管理。

```text
Dashboard ──GET Run SSE──────────────▶ daemon Run Event Hub
Dashboard ──POST steer/stop──────────▶ RunService
                                            │
                                            └── private turnId ──▶ Codex app-server
```

- browser authority 只有 Run ID 与 daemon-generated `turn_revision`；Codex `turnId` 不出 driver。
- `turn/steer` 只接受 bounded guidance text；`turn/interrupt` 不接受 browser command。
- assistant delta、activity summary 与 intervention acknowledgement 只存在于 bounded memory SSE replay，不写 SQLite 或普通 logs。
- activity normalization 只公开 command label、file count、MCP server/tool 等安全摘要，不公开 arguments、results 或 reasoning。
- terminal SSE 到达后，Dashboard 必须关闭 Live stream 并重新读取 authoritative Run，避免 row/detail/session/summary 分裂。
- completed Run 不在 Dashboard 内继续 multi-turn；后续操作使用已有 Terminal Resume boundary。
- app-server 单帧上限为 16 MiB（包括历史对话响应），按分片累积，完整帧只合并一次，避免大消息反复复制。超限仍以 `RUNTIME_PROTOCOL_FRAME_TOO_LARGE` 收口，不能无限分配内存。
- protocol request、frame、Run timeout 与 process shutdown 都有上限；`SIGINT` 无效时升级为 `SIGKILL`。

### Context capability isolation

Schedule 可分别把 `skills` 与 `integrations` 设为 `inherit` 或 `disabled`。旧 Markdown 缺省时保持 `inherit / inherit`；Codex 的 Dashboard/API 新建时默认 `disabled / disabled`。`integrations` 只包含 MCP servers、plugin MCP 与 Apps/Connectors，不包含 Web Search 或 Codex core tools；Sandbox 仍独立决定文件系统与网络权限。

Codex adapter 在 spawn 前用同一 executable、cwd 与 child environment 执行 bounded `codex mcp list --json`，再通过本 Run 的 app-server argv 明确禁用 plugins、Apps 和枚举到的 MCP identities。`skills: disabled` 时，adapter 在 `thread/start` 前调用 `skills/list`，为该 Workspace 的每个 Skill path 写入 thread-local disabled config，同时关闭 Skill search 与 Skill MCP dependency install。任何 discovery 失败都在创建 Thread 前 fail closed，返回 typed Run error；不得以“部分禁用”继续执行。

## Terminal conversation read

Completed Run history does not create a Rillo transcript store:

```text
Dashboard ──GET /runs/:id/conversation──▶ RunService
                                               │ trusted Run facts
                                               ▼
                                     Runtime adapter readConversation
                                               │ thread/items/list
                                               ▼
                                      CLI-owned local session
```

- browser 只能提交 Run ID；`RunService` 从 ledger 取得 runtime ID、session ID 与 immutable Workspace snapshot；
- Codex adapter 启动 bounded app-server client，优先使用 `thread/items/list` 分页读取，旧 CLI 明确不支持该方法时才回退 `thread/read({ threadId, includeTurns: true })`；
- response 只规范化 `userMessage` 与 `agentMessage`，丢弃 reasoning、command、MCP/tool payload 与其他内部 item；
- normalized messages 仅存在于 request/React query memory，不写 SQLite、Run logs、localStorage 或 persistent cache；
- 本机 CLI session 缺失或协议不可用时返回 typed unavailable，UI 可回退到已经存在的 bounded `final_message`；
- 该路径只读历史；completed Run 的继续对话仍通过 Terminal Resume，不从 Dashboard 创建 follow-up Turn。

## Session browser

`server/src/session-browser.mjs` 注册会话 adapter，独立于 Run ledger。当前仅注册 `runtime/adapters/codex-sessions.mjs`，未来 Claude Code 通过自己的 adapter 读取原生数据，无须模拟 Codex JSON-RPC。会话 provider 与 Scheduled runtime registry 的能力分别维护，关系工具支持某个 agent 不代表其原生 Sessions 数据读取已经实现。

Adapter 提供 `id/name/runtimeId/storeId/capabilities`、可信 `resumeOptions`、`list`、`workspaces`、`readSession`、`messages`、可选 `children/timeline/activity/branches` 和 `close`。跨来源引用由 `provider + store_id + session_id` 组成；store_id 由服务器配置的数据目录生成，客户端不能传入任意数据根。Codex 使用具体 thread.id，不使用 fork 共享的 root sessionId。resumeOptions.codexHome 显式设置恢复命令的 CODEX_HOME，避免终端环境切换到另一个数据源；launcher 只接受绝对路径并 shell-quote。列表统一返回 title、preview、workspace、branch、时间、state、可选 snippet、is_subagent、native_parent、forked_from 和 next_cursor；Codex 的 is_subagent 依据 parentThreadId 或 source.subAgent 标记，native_parent 优先使用 parentThreadId，再读取 source.subAgent.thread_spawn.parent_thread_id；无父级的 review 等 subagent 仍保留来源类型。搜索能力必须显式声明。数据源是真相来源，不将 transcript、搜索命中或目录清单写入 SQLite。

当前Codex adapter经现有executable resolver启动列表和对话共享、空闲45秒关闭的只读app-server。初始化开启experimentalApi，浏览RPC最多20秒、协议帧最多8MiB；原生元数据每页最多100条，来源为cli/vscode/appServer/exec，归档单独查询。

macOS LaunchAgent使用Standard进程类型，避免Background分类对用户触发的搜索施加后台CPU及I/O限流。正文搜索由codex-sessions/file-search.mjs优先处理。复用浏览连接分页调用thread/list(useStateDbOnly:true)，避免每批重复启动app-server；先应用cwd、branch及来源限制；realpath后的JSONL必须位于所选数据根的sessions或archived_sessions内。优先解析Codex安装中的rg，再检查PATH及常见工具安装目录；shell:false、忽略rg用户配置，每批最多100个路径且参数不超过48KiB，最多两批并发。正则只接受Codex用户/助手消息和旧event_msg文本，每文件最多一个命中，只输出短节选，不传输整行图片或工具输出。stdout按NUL文件名与LF记录边界解析，并限制每条输出16KiB。结果按活跃时间和ID排序；首次最多检查16个文件，后续最多两批各100个文件，每次检查后即返回。files前缀cursor绑定查询及筛选，按最后已检查会话继续，结果超过limit时按最后返回命中继续，空批次也能前进；scanned_count为本批检查的候选会话数；正文和节选只在本次请求内存中，不建搜索库。缺少rg或元数据不指向普通JSONL时使用原生thread/search；该路径首批limit=1，后续正常批次，过滤空页最多继续3页并返回body前缀cursor。两条路径每批均最多60秒；取消文件搜索会停止本次rg，并在当前元数据RPC结束后停止继续翻页；取消原生搜索会关闭其专用app-server，不会主动关闭共享浏览连接；错误使用SESSION_BROWSER_SEARCH_FAILED。

列表及原生children使用useStateDbOnly=true，避免前台重复扫描rollout修复索引。`adapters/codex-sessions/metadata.mjs`按adapter实例隔离数据源，对规范化参数合并并发请求，最多缓存64页元数据；3秒内直接复用，3–30秒先返回缓存再刷新，过期等待新结果。正文、搜索及命中片段不进入该缓存。UI根列表与目录使用相同100条原生页，不截断数据或重写native cursor。正常核验在首次读取3秒后由独立app-server执行，单数据源合并，最多每5分钟扫描一次非归档与归档页，完成后失效缓存；失败不关闭交互连接。初始根列表为空时必须等待核验，失败不能当作空列表。后台连接完成即关闭，adapter.close释放连接、watcher和timer。

原生通知、sessions/archived_sessions下的jsonl变更及session_index.jsonl触发失效，1秒合并发布SSE。root watcher只监听上述入口，不递归插件或其他配置；日志watch失败时由页面可见期间15秒元数据补查与按需后台核验兜底。目录、分支目录、无搜索的列表、children和relations接受修订；正文搜索不被事件轮询。旧代请求不能覆盖新代缓存。

命中预览使用 `thread/searchOccurrences` 返回的 turnCursor，再调用 `thread/turns/list`；只展示 userMessage 文本和 agentMessage，忽略工具与 reasoning。每次最多 5 个 turn、256 KiB 字符，单消息最多 16 KiB 字符，截断时显式告知；命中消息预留空间。旧版本缺少搜索/分页方法时返回 typed unsupported，不使用 preview 替代正文搜索。当前只定位首处命中，允许切回最近对话与加载更早页。

HTTP 入口为 `/api/v1/session-browser/providers`、`/:provider/workspaces`、`/:provider/sessions`、`/:provider/activity`、`/:provider/sessions/:id/read|children|timeline|messages|resume` 以及 `/relations`、`/links`（均在 session-browser 前缀下）。读取支持有界 query/workspace/archived/cursor/limit；具体会话接口校验 store_id。relations 必须指定完整引用。恢复 POST body 仅允许 store_id；服务重新读取原生 metadata 和已知 active 状态，再使用持久化终端设置调用现有 launcher。launcher 优先聚焦已有 pane，只有新建时才检查物理目录与 CLI；active 会话未匹配到 pane 时返回 409，不重复启动。响应的可选 action 为 focused、new_tab 或 new_window。Codex status 仅代表该 app-server 已知状态，不提供跨进程的全局运行锁。

`terminal-launcher.mjs` 串行处理恢复请求。Otty 按 runtime 与完整 agent_session_id 查 pane，匹配后只 focus，不发送恢复命令；原生发现启动中的短暂空档仅复用本服务刚创建的 pane。无匹配时在 focused window 新建 tab，没有窗口才通过 open 创建窗口并使用初始 pane，不改已有窗口标题。权限、控制接口和歧义错误直接返回，不当作无窗口处理。Ghostty adapter 使用原生 AppleScript 1.3 API，按前台窗口优先新建 tab；无窗口时新建窗口，不额外创建空 tab。`runtime/ghostty-targets.json` 仅保存 runtime、可信数据根、session ID 到原生 terminal ID 的关联，权限 0600、原子写入、最多 256 条，每次定位先核实 pane 存在。它不保存正文，不按目录或标题猜测手动打开的 pane；旧 pane 关闭后重新恢复会新建 tab。Terminal.app 保持原有打开行为。

`session-link-store.mjs` 是独立关系存储，使用 session-links.sqlite，仅保存完整父子引用、来源与创建时间。登记使用事务和 child 唯一约束，拒绝自关联、不同父级、反向或间接循环，同边幂等；解除是显式操作。服务在写入前读取原生 metadata 验证引用，并同时检查原生 subagent 与登记关系形成的祖先链（最多 64 层、30 秒预算）。fork 是独立 provenance，不参与协作父子判断。原生关系只读，不写入关系库。children 先分页返回登记关系，再读取原生 children；原生正文失效不删除已登记引用。

Codex timeline的from/to均省略时，scope=session，主读thread/items/list，每HTTP请求最多3页、每页100 item；显式时间窗兼容Turn segments组合分页。bounds返回创建时间start_at、最后一条所属用户/助手消息end_at、end_state及indexed_from。消息时间优先completedAtMs，再用startedAtMs；旧数据缺失时由codex-rollout-timing补读原始记录时间。points不计fork创建前历史、工具或reasoning；无法可靠恢复的末条时间仍保留unknown。

时间缓存仅含item/Turn ID、时间、角色和原生分页锚点，不留正文。消息索引最多50会话、每会话50,000 point/1024 native page、滑动5分钟TTL。updated_at改变后先清除新版本覆盖证明，保留有界精确ID锚点。对已从头读到末尾的完整索引，codex-rollout-history通过可信原生日志路径、同一文件身份与完整旧前缀SHA256验证历史未变，再确认旧末条消息的ID、时间、轮次和角色仍出现在新头部；满足才复用旧时间点。文件最多64MiB，读取时变化、截断、重写或无法证明均重新读取，撤回导致旧末消息消失时也重读；不缓存日志字节。复用结果以可失效的opaque snapshot cursor每次最多300点分页，不将旧native cursor误当成新页位置。按时间定位接受可选item_id，以区分同一时间的消息；原生页移动时用thread/items/read按turnId和itemIds验证目标，不静默替换为相邻消息。未覆盖目标返回SESSION_TIMELINE_INCOMPLETE，前端自动补读时间元数据后重试。coverage区分partial/complete/unsupported；旧CLI的正文定位可回退Turn级，但热力条不伪造消息时间。正文容量限制和媒体占位保持不变。

workspaces返回每个目录可选的去重branch_names，直接从同一100条原生元数据页聚合，不增加索引扫描；跨页分支名由前端去重，未知分支不生成子节点。新增GET /api/v1/session-browser/:provider/branches返回分支名、已观测会话数、去重workspace_paths、session_ids与next_cursor；只读取同一来源的100条元数据页，与目录及列表复用缓存。branch参数按完整名称精确筛选列表与原生正文搜索结果，不向原生接口发送未经支持的分支过滤参数。过滤后的空页保留原生cursor，前端自动继续；分支目录跨页按会话ID去重，绿点由已载入会话ID与live presence匹配。没有分支元数据的会话仍可在全部会话中访问。React Aria空结果占位使用display:contents，分页观察器跳过无布局尺寸的占位，转而观察真实分页标记。

API v5 的 MCP 通过 mcp/src/session-client.mjs 转发已有 HTTP 接口，提供原生会话查询、正文搜索、关系查询及登记，和定时任务 CRUD、启停、立即执行、执行记录与 runtime 查询。新增会话消息控制使用独立 provider/transport 链和持久化回执，详见下文“原生会话消息控制”；完整工具表见 README。修改类工具保留 expected_etag 并发检查，schedule_run 要求幂等键。查询保留游标和搜索范围，不保存另一份对话正文。Task lifecycle、attribution、checkpoint、summary、projection、spool 不再进入运行链路。旧 Task 路由统一 410 TASKS_RETIRED，正常请求还校验客户端 API version；旧插件不能静默继续写入。

MCP 的 session_messages 保持默认 page 分页，并增加 head/tail/all 历史读取模式。head/all 请求 REST messages 的 order=asc，由 Codex 原生 thread/items/list 或 thread/turns/list 正向翻页；tail 使用 desc，所有输出批次内部均按时间正序排列。历史读取游标包含 provider/store/session/mode 作用域、原生页游标与页内偏移，不保存正文。单次聚合限制为 50 页、25 秒与 max_chars；完整性依据历史是否读完及原生/聚合截断标记，不把局部内容称为全部。原生消息方向通过响应 order 校验，旧服务必须先升级，禁止静默把最近页当作开头。

codex-rollout-timing仅在可展示消息缺少原生时间时启用。路径来自thread/read的私有path，通过WeakMap传给时间读取器，不公开给浏览器；realpath后必须位于配置数据根的sessions或archived_sessions内。最多读取64MiB文件、单行4Mi字符、50,000条消息；缓存16份时间/ID/摘要索引、5分钟TTL，文件大小或mtime变化即失效，合并同路径并发扫描。精确role/item ID优先；生成ID仅允许turnId/role/完整文本摘要唯一匹配，歧义保留未知。正文只在扫描时临时解析，不缓存、写库或日志；图表和正文使用同一补齐结果。

可选activity()与live_presence返回store_id、available、sessions及checked_at。sessions为现有共享app-server中已加载会话的规范化元数据，保留state和active_flags；通过CODEX_HOME/app-server-control/app-server-control.sock进行WebSocket连接，分页调用thread/loaded/list，再以最多4并发thread/read(includeTurns:false)读取状态。只发送initialize、initialized与这两个只读查询；不调用resume/start，不启动或终止共享服务器。快照缓存3秒并合并并发；thread/status/changed等原生事件立即失效缓存并发布revision，前端同时每5秒补查。连接失败撤下旧状态并返回available:false，不使用lsof、进程扫描、文件描述符或日志更新时间推断。历史查询仍使用独立stdio连接，不能作为实时状态来源。Unix socket状态读取无macOS平台分支；其覆盖范围是所连接共享服务器，不声称全机发现。

React Sessions仅提供Tree，会话树与正文搜索共用目录、选择和阅读面板。侧栏提供Workspace/Branch两种分组；branch_groups能力控制分支入口，group偏好保存在URL及localStorage。Workspace以workspace为一级、branch为二级，Branch按相反顺序呈现，两者共用可折叠目录树。选择一级节点仅保留该维度限制，选择二级节点同时保留branch与workspace；切换分组保留筛选、搜索与当前正文，自动展开选中父节点，折叠不改变筛选。窄屏选择器提供对应的两级选项。列表和正文搜索的查询键均包含完整branch与workspace，仅在用户改变筛选时清空预览。目录、会话和更早消息通过IntersectionObserver在滚动边缘自动翻页；正文搜索保留已展示结果并连续请求后续批次，不依赖滚动位置，空搜索页也自动继续。目录计数仅为已观测数量。正文搜索debounce 300ms，在ComboBox/Popover/ListBox浮层展示，选择后按该query定位。搜索使用独立sessionSearch查询键，即使query为空也不与主列表共用查询，避免禁用的搜索observer覆盖列表queryFn、分页大小或缓存生命周期。会话树沿用sessionList查询及原生cursor，底层list接口不受展示视图删除影响。活跃状态独立每5秒刷新，不轮询正文搜索。整页错误仅由来源、根列表、目录或分支目录查询触发，每3秒重试空闲的失败查询，不反复中断慢请求。正文、时间线、子会话、关系与搜索的503/504或超时只影响对应区域，不参与整页重连；搜索失败显示原因，正文失败保留可用内容及其他会话入口。SSE实时状态独立于原生会话查询结果。共享Codex连接按实例处理关闭，旧连接延迟失败不能关闭新连接。内容仅在查询内存中；REST沿用客户端IP、Host、Origin、JSON与脱敏边界。

热力/children队列最多4个在途请求，后台任务最多占3个，为显式定位或展开保留位置；排队时用户请求先执行，离屏通过AbortSignal取消等待和HTTP读取并停止继续翻页。共享浏览连接上的HTTP取消不宣称能够中止已经发出的原生RPC；正文搜索把Query取消传到fetch及服务端，停止本次rg或原生回退搜索的专用app-server，终止旧查询。自动分页每次加载后重新验证IntersectionObserver，不沿用插入新内容前的旧可见状态。

## Run output files

React Run detail 使用 `POST /api/v1/runs/:id/files/open`，JSON body 只允许 `{ path }`。接口沿用客户端IP、Host、same-Origin 与 JSON 请求保护。RunService 从 ledger 读取 immutable snapshot 和 file_changes；客户端不得传 workspace、command 或 application。

文件名在两平台均链接到`GET /api/v1/runs/:id/files/preview?path=...`。入口复用file opener的Run记录及workspace/realpath校验，返回303重定向到`/run-files/:token/:filename`；临时token使用24字节随机值，仅在RunService内存保存30分钟，最多64个，shutdown清空。GET/HEAD资源以入口所在目录为根，校验realpath边界与普通文件类型，拒绝隐藏路径、符号链接越界和未知类型的附属资源；不提供目录列表。静态资源按扩展名返回MIME，未知类型的已记录入口按attachment下载，文件流直接从打开的handle传输，不将正文装入JSON或持久化。不保存历史快照，目录内相对URL保持可用，站点根路径不重写。

预览与现有API共用客户端IP及Host校验。HTML响应使用CSP sandbox且不授予allow-same-origin，脚本仅能读取当前token目录及HTTPS资源；不允许提交表单或作为iframe嵌入。资源响应设置no-store、nosniff、no-referrer和Access-Control-Allow-Origin:*，仅有效token的GET/HEAD路径接受沙箱的Origin:null，供模块、字体及fetch读取资源。Dashboard API的Origin及无CORS策略保持独立。React使用原生target=_blank与noopener noreferrer链接，避免异步window.open被浏览器拦截；已删除文件不生成链接。macOS系统打开作为独立操作保留，Linux只提供浏览器访问。

file opener 要求 path 精确匹配该 Run 的非删除文件记录，相对路径以 snapshot.workspace 解析；路径规范化及 realpath 后均须处于该 workspace 内，且目标必须为普通文件。macOS 通过 argv array、`shell: false` 调用 `/usr/bin/open`，参数为编码后的本地 file URL，使用系统默认应用。未记录、已删除、缺失、越界、非普通文件、非 macOS 或 opener 失败均返回可展示的 typed error；不回写 Run，也不执行 shell 拼接命令。

## Schedule clock

`scheduler-clock` 在 `daemon` 内根据 wall clock 和 durable occurrence key 计算到期任务。filesystem watcher 负责低延迟 definition change，周期 rescan 提供最终一致性。sleep/wake 可产生 bounded catch-up，但同一个 occurrence key 不能创建两次 Run。

Definitions directory 切换是一个受控迁移：验证目标、迁移/合并、切换 repository、替换 watcher、持久化 config；任一步失败都恢复旧 repository 和 watcher。

## Dashboard views and timeline interaction

Production `daemon` 读取 `ui/dist/react.html`，脚本与样式内嵌。品牌图使用 `ui/assets/rillo.png`（豪猪宝宝“刺刺”原图），由同源 `/rillo.png` 路由提供，供导航与 favicon 共用，favicon 由页面入口设置；生产服务缓存一小时，页面图像 URL 携带品牌版本参数以避免换图后仍显示旧缓存，开发服务不缓存。构建 adapter 时将同一文件复制到插件 assets，发布包携带这些图片。`ui/dist/index.html` 继续随 release 打包，仅用于回滚和迁移对照，不参与默认路由；source preview 与 installed runtime 因此使用同一 React entry 和同一 API contract。

顶层导航只有 Sessions 与 Scheduled；Sessions仅保留Tree。SessionsView持有childPages与按完整引用读取的ancestor元数据，通过collectSessionFamily仅遍历当前根列表可达的子页和父链；切换workspace/branch不会混入其他范围的旧子页或祖先，同一完整引用只展示一次。父会话未在当前页时，由SessionAncestorSource通过共用读取队列补读，加载期间显示读取主会话，失败后明确提示父会话暂不可读取。projectSessionTree只允许真实主会话作为一级节点：有原生父级、登记父级或is_subagent标记的会话不能因父级缺失、冲突或循环而升为一级。选中已读取子会话时按祖先路径自动展开，用户手动折叠不会因状态轮询重新展开。collectSessionRelations合并原生metadata与登记边并按端点去重；indexSessionRelations分别索引parents/children和forkSources/forks，fork永不参与父子树构造，正常fork仍作为独立主会话。标题行合并Subagent/协作标签、子会话及派生Fork数量与来源入口，数量只代表已发现的直接关系。Fork来源显示forked from标题或短ID；Codex created_at可确认时追加at时间，表示新fork会话创建时间，不用复制历史的首条消息或updated_at推算。原生时间来源见[rollout recorder](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)与[thread summary](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/thread_summary.rs)。浮层使用现有Dialog/Popover，点击按完整provider/store/session引用读取；Escape关闭并恢复焦点。详情关系面板合并当前已发现的边，支持从来源查看派生Fork。

Cards与List均已退出产品入口，组件、专属样式和视图状态已移除；挂载时删除旧sessions模式参数与rillo.sessions-view本机偏好，不保留兼容视图。Sessions样式由feature自身的sessions.css维护。侧栏350px，sheet收起时会话树填满剩余空间；sheet打开时宽度clamp(340px,32vw,480px)，压缩树的可用宽度。复用Drawer的container portal与modal=false，不遮挡会话树；keepMounted保留正文和阅读状态，关闭只收起面板，不清空selection或重复读取消息。面板收缩时保留正文最小宽度，避免重新换行带动滚动位置。1100px及以下隐藏侧栏并提供目录选择器，680px及以下打开sheet改为全宽阅读、关闭恢复树。首次进入不自动打开会话；点击标题、搜索命中或操作热力条按需打开。主导航和侧栏分组统一使用segmented-control圆角中性底色与选中项阴影，树工具栏仅保留状态优先排序与sheet展开入口。app-shell统一40px头部、零padding，header/main/Sessions不绘制外框和外圆角，仅保留内部分隔线，切页不改变内容起点。正文12px，头部单行标题/操作，关系浮层不挤正文。Tree每行严格只有title、subtitle、timeline三个直接区域；标题单行ellipsis，状态点位于标题前，其余关系、fork与读取错误信息也只出现在标题行。subtitle只放完整workspace路径与靠右的分支。桌面条目74px、相邻间距6px，细边框与浅背景区分各项，子项缩进18px并绘制连接线；热力条12px、手机18px。中栏不显示起止时间，对话标题下方使用同一sessionTimeline查询的bounds展示创建时间至最后一条用户或助手消息的时间范围；仅在bounds已知时显示，不以updated_at或当前阅读位置代替。SessionTimeRange与TimelineSource共用查询键及分页结构，避免重复索引；过长路径从开头省略，title保留全文。正文标题右侧及每行均有带边框的常显终端继续按钮。状态按钮按Needs you、Working、Ready、Inactive计数并点击优先排序，取消后恢复最近消息顺序；保持父子层级，将命中子会话的父节点优先排列，计数不包含无法展示的孤立子会话。Needs you与官方agents分组一致：等待审批/输入或主会话systemError；子会话systemError归Inactive。行内颜色圆点标明状态，详情和搜索使用同一实时快照；目录绿点仅由原生active状态聚合。状态不可用时不把历史标记为Inactive，不影响历史浏览。


每条热力条使用独立会话起止范围，不再使用全局7天或日/时/分切换，不聚合项目曲线。secondHeatCells按真实UTC秒计数，空秒稀疏表示；Canvas绘制矩形，以每秒消息数的对数映射颜色深度。物理像素容不下所有秒格时保留该像素内最高每秒计数，不能叠加alpha伪造密度。TimelineSource在行进入屏幕120px附近时持续分页，离屏暂停补页，原生并发最多4。SessionChildrenSource、SessionAncestorSource与TimelineSource共用sessionReadRequests最多4并发；树中接近视口的会话挂载子会话读取源，缺失祖先通过共享队列补读元数据。子页缓存60秒、gcTime5分钟，只为确有子节点的行提供展开按钮；useLayoutEffect在paint前同步子节点。无时间、unavailable或unsupported不持续伪造索引。

悬停从pointer事件直接安排requestAnimationFrame，连续移动时每帧取最新目标，同一消息ID/时间不重复定位；精确ID避免同时间消息互相覆盖。尚未读取的秒只显示时间，不显示虚假的0条或阴影说明；可见会话继续自动补页，读到悬停区域后自动定位。pointer capture支持触屏/拖出行，方向键切相邻消息、Home/End跳首尾。正文按当前已加载消息的ID与时间直接定位，不改变查询键；只有目标不在当前页时才读取。慢读取期间保留最新目标，完成后先检查返回页能否满足新目标，再决定是否继续查询，不因每次鼠标移动取消在途读取，也不把旧请求的匹配标记用到新位置。不增加跨窗口正文缓存，gcTime仍为0。滚动使用约100ms的可转向缓出动画；手动输入及更早分页锚点维护取消动画，reduced-motion直接定位。手动滚动暂停内部跟随，下一次热力条操作发出followRequest自动恢复，不提供恢复按钮。

桌面热力条位置保持稳定，hover不滚动树行；最近消息重新请求原生head。正文定位仅在conversation容器中用动画帧插值更新scrollTop，原生scrollTo使用instant避免叠加浏览器动画；减少动态效果时直接到目标，手动阅读立即停止自动滚动。正文scroll事件经requestAnimationFrame读取视口中线对应消息，回传原生消息ID和时间。非悬停时，竖线、时间提示与三角统一使用readingAt，键盘焦点和旧selectedAt不能覆盖正文位置；悬停/拖动临时显示预览位置，离开或结束后恢复实际阅读位置。回传不能发起seek或重读请求，避免双向循环。普通阅读首次滚到最近消息，向前分页仍用原可见消息DOM位置校正。历史Markdown为static，Scheduled行为不变。窄屏通过sheet在会话树与全宽阅读之间切换。

UI验收需覆盖真实会话数量、标题长度和时间分布；截图可匿名化文字，但不能只靠少量规整fixture判断产品效果。首次悬停、清空后重开、连续浏览、加载更早历史须检查鼠标下方布局与阅读位置是否保持稳定。

## Compatibility and migrations

Scheduler schema v4 是当前 unified Run ledger。v1–v3 tables 只保留在 migration code 中用于升级已有数据库，不得重新成为 active execution path。

历史 Task schema 与生成资产只供历史对照；当前不提供 Task import/migrate，不打开旧库，也不启动旧文件重建。Session links schema v1 独立于 Scheduled schema。

安装或卸载时可以清理由 Rillo 明确拥有的旧 per-Schedule LaunchAgents；cleanup 必须验证 owner、mode、symlink 和 canonical program path，无法确认的文件 fail closed。

## Verification gates

```bash
npm run build
npm run build:adapters
npm run check
npm test
git diff --check
```

架构变更还必须证明：

- Markdown → due occurrence → queued Run → CLI → terminal Run 的 integration test；
- runtime resolution 卡住时 cancel/shutdown 能及时完成；
- missing runtime/model catalog 返回 typed state，不返回 missing route；
- release artifact 包含 registry、adapter、Run service 与 migration，且不包含 legacy scheduled runner；
- source Dashboard 与 daemon API version/capability 不兼容时显式失败。
- fake app-server E2E 必须覆盖 Run-specific SSE、mouse steer、Stop、terminal authoritative refresh 与 CLI-owned conversation read；runtime `turnId` 和 guidance 不得进入 Run response、SQLite 或 logs。
- Schedule capability E2E 必须覆盖 Markdown/REST policy、immutable Run snapshot、integration argv overrides、Skill thread config、mixed policies与 Web Search 不受影响。

### Schedule Fast mode

Schedule Markdown 与 CRUD API 的可选 `fast_mode` 为 boolean 或 null，仅 Codex 支持显式 boolean。省略/null 继承运行时默认，true 开启，false 使用普通速度；旧 definition 无需迁移。Run 沿用完整不可变 snapshot 保存选择。Codex interactive adapter 将显式值映射为 `turn/start.serviceTier` 的 `fast` / `default`；CLI invocation 对应 `-c service_tier="fast"` / `"default"`，继承时不传覆盖值。不要用降低 reasoning effort 实现 Fast mode，也不要修改用户的全局 Codex 配置。

### Codex 临时失败恢复

codex-interactive-session 在已确认的 turn/completed.failed 后读取 error.message 与 codexErrorInfo，必要时使用同轮 error 通知补全诊断，不再将所有 provider 失败折叠为 RUNTIME_PROCESS_FAILED。容量不足和限流使用独立错误码；未知失败仍保留泛化错误。

同一个存活的 app-server、Thread 和 Run 中最多新增 3 个恢复 Turn，延迟 10/30/90 秒并增加最多 20% jitter。恢复输入只请求继续未完成工作，保留原 model、effort、serviceTier、workspace、sandbox 和已确认文件变更。RunService 仍只启动一次、持有一个 completion；原 occurrence 防重与 single-active-run 约束不变。重试期间不写终态、不重置任务总超时，也不重新提交初始 prompt。实时流复用 activity_started/completed 和递增 Turn revision，日志只记录有上限的 provider 错误与重试元数据。

非只读 item 尚未完成或失败结果不确定时不自动继续。RPC 超时、IPC 关闭和进程退出不被当作可安全重放的模型错误。取消、任务超时和 shutdown 同时清理 retry timer；Stop 在 backoff 中验证旧 Turn revision 后直接结束 Run，不向已结束的 Turn 发 interrupt。旧 turn/start 响应不得复活已进入 backoff 的 Turn。OpenCode 不进入此恢复链路。

### Codex 连接关闭

App-server client 的 `onClose` 是一次性生命周期通知，覆盖无 pending RPC 时的进程退出、pipe error 与主动关闭；晚订阅者立即收到已保存的关闭结果。启动未完成时关闭也必须拒绝 `started`，不能留下无限等待。Interactive session 在启动请求前订阅，完成时退订，异常关闭立即 settle 为 failed，保留数字 exit code、已有 session ID 和已确认 file changes；不把原始 stderr、RPC payload 或未完成回复写入错误字段。主动取消与正常 Turn 完成先 settle 再关连接，避免被错误覆盖。RunService 沿用 terminal persistence 与 SSE 更新界面。


### Schedule network access and recovery

可选 `network_access` 为 boolean/null，仅 Codex 支持；缺省继承。Markdown、CRUD、Run snapshot 与两个编辑器必须保持 true/false/null 的语义。Interactive adapter 在 `thread/start.config` 传递 `sandbox_workspace_write.network_access`，CLI 路径传递对应 `-c`；不改变审批策略、全局配置或其他任务。该原生键仅影响 workspace-write 的 shell 网络策略。

`RunService` 在 normalized `session` 事件到达时立即调用 `RunStore.recordSession`，而不是等待终态。完成、取消、超时与异常分支保留已知 session；restart recovery 仍将 open Run 标为 interrupted，不自动接管进程。UI 仅终态允许 Terminal Resume。

Dashboard SSE 的 changed/open 必须使 schedules（含运行历史）和 runs（含详情）查询失效，并沿用 2 秒合并窗口。Live SSE 重连保留 cursor 和草稿，reset 后清除旧 cursor；连接丢失或恢复时补读 authoritative Run，使遗漏终态也能关闭 stream。客户端最多保留 500 条实时条目；完整对话仍由 Codex-owned session 提供。

Cadence 输入校验错误返回 `SCHEDULE_INPUT_INVALID`，不能暴露为泛化 500 错误。

已到期的一次性定义仍须可读取、编辑与查看运行历史，不能因时间流逝变为 invalid。读写 codec 允许过去的 once 时间；新建或明确修改 cadence 的 API 仍要求未来时间，调度防重由持久化 occurrence 负责。

历史对话优先使用原生 `thread/items/list`（倒序分页，每页 8 条，最多 128 页），仅保留 user/assistant messages 后按时间正序展示。字符总量仍限制为 1 MiB，达到页数或容量上限必须标记 truncated；不落盘工具输出。仅旧 CLI 明确返回 method-not-found 时退回有 16 MiB 上限的 `thread/read`。

Run SSE 每 15 秒发送 comment 保活，关闭 response 时同时清理 timer 与订阅。开发代理必须立即转发响应头，不能等下一条事件才让浏览器进入 connected。全局变更只刷新 Run 元数据，避免反复启动 CLI 重读终态对话。

### OpenCode runtime

`opencode` adapter 复用 Registry、RunService、Scheduler 与 ledger。每次 Run 启动只监听 loopback 且随机 Basic auth 的原生 `opencode serve`；HTTP 提交 prompt/abort，SSE 提供即时事件，状态与最近消息轮询用于恢复断线期间遗漏的结束事实。用户消息 ID 使用原生 ascending 格式，最终回复必须匹配当前 prompt 的 parentID，工具调用步骤不能视为任务完成。实时流过滤用户文本与 reasoning，不持久化 SSE 原文。

OpenCode 不支持 OS sandbox 或独立禁用 Skills/MCP。定义与执行边界都拒绝非 `danger-full-access`、禁用扩展能力以及显式 Fast mode/network policy；模型为 provider/model，reasoning 字段保存原生 variant。权限询问和交互问题结束 Run 并保留 Session；不自动扩大工具权限。取消和超时先调用原生 abort，再结束自己创建的进程组。

历史读取使用原生消息接口，最多 100 条、1 MiB 文本；已结束 Run 的 Session ID 是 Terminal Resume 入口，恢复前验证 Session，再用已解析的 executable 与 `--session` 参数启动。Session ID、workspace 与 runtime ID 均取自可信 Run，不接受浏览器构造命令。服务 stdout/stderr 写入有大小上限的私有 Run 日志；stdout 只追加工具名、OpenCode 给出的标题或脱敏命令摘要，不记录工具参数或结果正文。provider 错误在 Run final message 中保留有上限的可读原因，并使用稳定错误码区分类别。

## 原生会话消息控制

`server/src/runtime/session-messaging.mjs` 负责验证完整 SessionRef、请求去重、会话级串行与通道调度；`session-messaging/providers` 各 provider 实现原生能力，通用调用失败不能直接当作未发送。每个操作筛选并顺序调用支持该动作的 transport，仅 delivery=not_sent 且 fallback=true 才降级。未知异常、写入后超时及断线保持 unknown。

Codex 使用明确授权方法列表的共享 app-server 客户端；状态读取客户端默认仍是只读。原生 queue/steer/interrupt 优先，CLI queue 仅是 queue 的备用实现。Claude SDK 和 stream-json CLI 通过相同的受控 worker 语义接入；恢复前验证 transcript 的 sessionId/cwd、数据源与原生 agent 目录，不创建与外部活跃进程并发的 worker。Otty 最后通道仅做明确匹配的 queue，不承担无条件打断。

`session-messages.sqlite` 由 daemon 独占，保存请求指纹、投递阶段及回执，不保存消息正文。初始化时 sending 变为 unknown；同一请求 ID 的目标、文本和操作不可改变。只读核对能证明原生接受时更新回执；未找到记录不构成失败证据。MCP/HTTP 都使用同一控制服务，工具列表及示例见 README。

Claude 从用户回显或回复流的 user_message_uuid/user_message_uuids 确认对应输入，忽略迟到的重复回显，同一轮消费的合并输入一起结束；打断必须收到指定受控轮次的 aborted_streaming/aborted_tools 结果，普通结束不视为打断成功。没有对应消息 ID 证明时保留 unknown，不凭队列文本推断。

Claude SDK 随 server vendor 构建并保留 Anthropic LICENSE；原生 CLI 仍由可执行文件 resolver 定位。关闭时先释放控制连接、等待在途投递记录收敛，再关闭回执数据库；空闲 worker 定时释放。


## Working windows and minute intervals

Cadence 增加 `interval`（整数 `minutes: 1..1440`）。非 once cadence 可带 `work_hours: { weekdays, windows: [{start,end}] }`；Markdown 与 HTTP/MCP 使用同一结构，weekdays 为 ISO 1..7。集中在 `scheduler/cadence.mjs` 校验时间、范围、重叠及固定时刻可达性，codec 只转换原有 human cadence 字段。Run snapshot 保留整个 cadence，不增加数据库列或第二个调度状态表。

窗口为同一天内的半开区间，end 允许24:00。无窗口的 interval 对固定经过时间网格取整；有窗口则从各段本地起点按经过分钟计算，起点和日期由服务本机 Date 语义决定。nextOccurrence 与 latestDueOccurrence 共用窗口规则；latestDueOccurrence 在关闭时段返回null，在开放时段将补跑下界截到当前窗口开始，避免重放上个窗口或周末积压。原有 occurrence key 和 Run 唯一约束继续防重，30秒调度节拍及正在执行任务的互斥行为不变。

工作时段只限制自动调度；已启动 Run 的执行及其已有内部重试继续完成，手动 Run 不受限。前端创建/编辑、列表摘要与 MCP schema 同步支持；用户未设置 work_hours 则维持旧行为。Legacy 回滚界面可以显示新摘要，但拒绝编辑含 interval/work_hours 的计划，防止静默退化为 daily 丢失约束。
