# dsh-task-timer

DeepSeek Harness 插件：在对话最下方的仪表盘（composer dock）里，新增一个**工作时长** pill，
展示本会话 agent 的**工作时长**；点开后给出**创建对话至今**；同时在左侧边栏、用户名那一行的
上方，显示**全部对话的合计使用时长**（`1小时29分 · 对话总时长`）。

## 它统计什么

`工作时长 = 模型时间(llmMs) + 工具时间(toolMs) - 等待回答(awaitMs)`。前两项直接取仪表盘
已在用的 `sessionStats` 投影，**不再自己折叠一遍事件日志**——仪表盘上「N轮N步」那个 pill
已经把模型时间和工具调用时间分开列出。

第三项是本插件唯一要自己折叠的东西。`sessionStats` 的工具时间是按 `tool/call` 到
`tool/result` 的真实跨度记账的，而 `ask_user_question`（以及 `exit_plan_mode` 的计划评审）
这类工具**要等你回答才返回**——你挂机两小时，它就诚实地记两小时工具时间。所以宿主侧另外
配对这几个调用，把它们的跨度单独累计成 `awaitMs`，再从读数里减掉。

因此**天然不计入**的还有：用户输入时间（`user/message` 与下一次 `step/start` 之间的空隙）、
轮次之间的挂机/空闲（`tool/result` 与下一次 `tool/call`、`step/start` 之间的空隙）——这些
时间从来不在 llmMs/toolMs 里，不需要减；跨轮挂机不需要额外处理，只有**问句未答的那段**
需要一个负数项，就是 `awaitMs`。

> 早于 1.4.0 的版本把「问了等你回答」的那段时间当成了工作时长：一次实测中，5 次提问的等待
> 合计 420.8 秒，占该会话读数 4.4%。口径修正见下，两侧（pill 与侧边栏合计）同步生效。

`awaitMs` 的配对规则与 `sessionStats` **逐字对齐**，否则减掉的和记上的不是同一段：

- 只有 `ask_user_question` / `request_user_input` / `exit_plan_mode` 这三种调用开等待；
  带 MCP 前缀的副本（`mcp__<server>__ask_user_question`）按最后一段识别；
- 等待在 `tool/call` 打开、在 `tool/result` 结算；**未结算的等待不扣**——那时仪表盘也还
  没把它记成工具时间，提前扣会把读数扣成负数；
- `turn/end` 时未结算的等待直接丢弃（取消/失败的轮次），`sessionStats` 同样是丢弃而不是
  计时，所以这段本来就不在读数里。

计划评审（`exit_plan_mode`）走的是同一类等待，一并扣除。工具的**审批弹窗**没有对应事件，
日志里分辨不出来，因此仍按工具时间计——这是已知边界。


弹窗里的**创建对话至今**是另一个口径：`最后一次对话活动 - 对话创建时间`，是会话本身的墙钟
跨度，包含挂机和用户思考，但**两端都钉在事件上**：

- 起点是会话 header 的 `createdAt`（不是第一条事件的时间，fork 出来的会话不会被祖先日志
  拉长）；
- 终点是日志里**最新一条推进对话的事件**（消息、turn/step 边界、工具调用对），不是
  `Date.now()`。因此一条对话没人再动、也没有新消息时，这个数**停住不动**，不会随着你挂着
  窗口而一秒一秒往上涨；一旦有了新消息，终点前移到那一刻，跨度自然把中间的间隔算进去。

这是"只统计到本对话最后一条消息生成结束"的口径，与上面那个"纯 agent 工作秒数"互补：一个是
对话活了多久，一个是 agent 干了多久。

## 工作原理

- **宿主侧 `lib/index.js`**：通过 `ctx.sessionProjections.register(...)` 注册一个极简的
  `taskTimer` 投影，发布三个端点——`createdAt`（建会话那一刻）、`lastActivityAt`
  （日志里最新一条推进对话的事件时间）、`awaitMs`（被问到答之间的累计跨度）。
  `createdAt` 没有任何事件能改变；`lastActivityAt`
  只接受白名单事件（`user/developer/system/message`、`turn/start|end`、`step/start|end`、
  `assistant/attempt|message`、`tool/call|result`），改名、改设置、归档这些元数据事件不算
  活动，否则给会话改个名就能把空闲的时钟重新拨起来。取值点仍是 `init(header, ...)`：这是
  框架唯一把 header 交给投影的地方。
  - 游标单调：`!(at > lastActivityAt)` 直接丢弃回放里乱序/缺时钟的事件；游标初值就是
    `createdAt`，所以 fork 继承来的那段日志（时间都早于本 header）不会把跨度拖成负数。
  - 等待表 `awaitCalls` 只在内存/检查点里维护（`{callId: 打开时刻}`），**不进 wire**：
    客户端需要的只是累计结果 `awaitMs`。
- **浏览器侧 `lib/client.js`**：向 `conversation.composer.dock`（对话底部仪表盘）注入
  `task-timer` pill，排在官方 `activity`（TPS）和 `usage`（Token）之后。
  - 主标签沿用仪表盘的值在前、名称在后格式：`51分24秒 · 工作时长`；
  - 时长按需进位：不足 1 分钟显示 `45.2秒`，不足 1 小时显示 `51分24秒`，满 1 小时后
    显示 `1小时29分` 并**不再显示秒**；分钟数不会溢出，不会出现 `60分`、`89分` 这类写法
    （整小时显示 `1小时`）；
  - 点击弹窗只给出仪表盘没有的两项：`创建对话至今`，以及被扣掉的 `已扣除等待回答`（后者
    只在真的扣过数字时才出现）。模型时间/工具时间不在这里重复——「N轮N步」那个 pill 已经
    分开列出，弹窗再列一遍是冗余；而扣减项必须写出来，否则 pill 的读数会比旁边的活动数字
    略小，却没人解释差在哪。
  - 弹窗里的这一行**打开时立刻刷新一次**，打开期间每秒走一格；收起后在后台每分钟
    轮询一次（`OPEN_TICK_MS = 1e3` / `IDLE_TICK_MS = 6e4`），不常驻秒级定时器。
    渲染值取 `min(now, lastActivityAt) - createdAt`：一旦追上终点（对话已空闲），
    连定时器都不再启动，等新事件改写 `lastActivityAt` 再自然恢复。
  - pill 与弹窗标题前都带 primitives 的时钟图标（`IconClockOutlineRegular`，14px、与文字
    间隔 `6px`），和旁边的 `activity`（仪表盘）、`usage`（数据库）两个 pill 一致；侧边栏
    合计行仍为纯文字，不画图标。
  - 弹窗**不自己复刻样式**：运行时从 ui-chat 挂载的 `stat-dialog.module.css` 里读回它那套
    带哈希的类名（`.xxxx_panel` / `_title` / `_titleRule` / `_details`），直接应用到本弹窗，
    因此背景、圆角、内边距、分割线、「N轮N步」弹窗与本弹窗**用的是同一份 CSS 规则**，
    不存在两套近似值；拿不到那份样式表时（不带 ui-chat 的装配）才退回内置的等价内联样式。
- **侧边栏合计**：向 `sidebar.footer.action` 注入一行 `1小时29分 · 对话总时长`，位置就在
  Settings／用户名行正上方；该行设了 `user-select: none`，鼠标划过不会把数字选进选区。

## 侧边栏使用时长怎么算

不额外读盘、不新开 RPC：直接复用侧边栏已经拿到的会话列表快照
（`sessions.list` 的 `ids` / `byId` / `projectionsBySession`），把每行的
`sessionStats.llmMs + sessionStats.toolMs - taskTimer.awaitMs` 加起来。

| 约定 | 说明 |
|------|------|
| 数据来源 | 会话行的 `sessionStats` 与 `taskTimer` 投影：已连接会话用实时值，冷会话用投影检查点缓存（`session_projcache`），因此不会为了这一个总数去解压历史日志 |
| 实时性 | 当前会话推进时，`projectionsBySession` 的实时值优先于列表里的旧缓存，该数值随 agent 工作增长 |
| 扣减 | `awaitMs` **逐行先减再求和**：等待属于某一条对话，先求和再减一个会话级总数在算术上不成立 |
| 排除项 | `origin === "subagent"` 的子会话行不计入——派发它的对话已经把这段时间算成工具时间，两边都算会翻倍 |
| 收起态 | 侧边栏折叠成 56px 轨道时整行隐藏（轨道里放不下说明文字） |
| 为 0 时 | 一条会话都没记录过工作时长时整行不渲染，不留空行 |

## 目录结构

```
dsh-task-timer/
├── package.json        # 插件清单（dsh.bundle + dsh.client）
├── cordis.patch.yml    # bundle 补丁：insert 一条 task-timer 条目
├── install.ps1         # 本机 link: 安装脚本（不随 npm 包发布）
├── LICENSE             # MIT
├── lib/
│   ├── index.js        # 宿主侧：注册 taskTimer 投影（createdAt + lastActivityAt + awaitMs）
│   └── client.js       # 浏览器侧：工作时长 pill + 创建对话至今行 + 侧边栏使用时长行
├── locale/
│   ├── zh.json         # 插件页显示元数据（中文），必须是 {"meta":{"title","description"}}
│   └── en.json         # 插件页显示元数据（英文），同上结构
├── market/
│   ├── index.json      # format 1 索引（托管到 http(s) 后供「发现」读取，不随包发布）
│   ├── PUBLISH.zh.md   # 上架 / 自建索引源说明
│   └── PUBLISH-GITHUB.zh.md # 推到 GitHub 并进 dshmarketplace.dev 的流程
└── test/
    ├── projection.test.mjs # 投影契约测试（init 取 header、游标单调、state/view 引用稳定）
    └── render.test.mjs     # 客户端 pill 渲染冒烟测试（SSR，断言样式、结构与创建对话至今）
```

`npm publish` 只发布 `package.json` 里 `files` 白名单列出的文件，加上 npm 强制包含的
`package.json` / `README.md` / `LICENSE`，一共 8 个：`lib/index.js`、`lib/client.js`、
`cordis.patch.yml`、`locale/{zh,en}.json`、`package.json`、`README.md`、`LICENSE`。`install.ps1`、
`market/`、`test/`、`node_modules/` 都不进包。

`locale/*.json` 的顶层必须是 `meta` 对象：插件页（设置 → 插件、插件管理器、发现）的标题与说明由
宿主 `readPluginMeta()` 读取 `locale/<语言>.json` 里的 `meta.title` / `meta.description`，缺这两项就
退回 `package.json` 的 `name` / `description`（于是中文界面显示英文说明）。文件名必须是语言 id
（`en`、`zh`），`en.json` 必须存在，否则整个 `locale/` 目录都不会被扫描。

## 安装

从公开仓库安装（`<dsh>` 指 DSH 安装目录下 `resources/runtime/cli/bin/dsh.cmd`，若已加进 PATH
则直接写 `dsh`）：

```powershell
& "<dsh>" plugin --profile desktop add github:ShuaihuiMou/dsh-task-timer
```

GitHub 与 Gitee 是同一份代码，直连 Gitee 等价：

```powershell
& "<dsh>" plugin --profile desktop add "git+https://gitee.com/sunxiaochuan2588000/dsh-task-timer.git"
```

想锁死版本就在 `#` 后跟完整 40 位提交 SHA——插件市场的 git 源、本仓库 `market/index.json` 都是这么锁的，
下面这条锁的是 1.4.1：

```powershell
& "<dsh>" plugin --profile desktop add "github:ShuaihuiMou/dsh-task-timer#d9d7fc0e2c5f49f71e671927e8d416e24390d3a8"
```

npm 上还没有这个包（尚未发布），等发布后 `add dsh-task-timer` 也等价。

调试本地源码时用 `link:` 装法，改动即时可见，不必重装；`file:`（不加 `link:` 前缀）则会把包
拷贝进 profile。在插件目录双击/运行 `install.ps1`，或手动执行：

```powershell
& "<dsh>" plugin --profile desktop add "link:<插件目录绝对路径>"
```

`install.ps1` 会按 `-DshCli <路径>` → `$env:DSH_CLI` → PATH 上的 `dsh` 顺序查找 CLI。

安装完成后**必须重启 DeepSeek Harness**（新 bundle 补丁要重载才会注册投影与 pill）。

## 验证

宿主侧投影契约已用真实 zod 跑通（`test/projection.test.mjs`），输出如下：

```
projection: createdAt + lastActivityAt + awaitMs published, cursor monotonic, waits paired, view references stable
```

它断言的是：`init(header)` 原样取 `header.createdAt` 并把游标起在同一个点（fork 的
`inheritedEventCount` 不参与）、只有对话类事件推进 `lastActivityAt` 且乱序/缺时钟不会回退、
`session/title` 等元数据事件不动游标、`wire.view` 对同一 cell 复用同一个 view 引用（注册表靠
这个引用比较抑制推送）、view 里不再出现 `llmMs`/`toolMs`/`workingMs`。

等待的配对另有一组断言：普通工具（含 `mcp__dsh__pwsh` 这种带前缀的）**不开等待**、
`ask_user_question` 与 `mcp__dsh__ask_user_question` 开、`exit_plan_mode` 也开；未结算的等待
`awaitMs` 保持为 0（此时仪表盘也还没记账）；结算后恰好等于 `call→result` 跨度；`turn/end`
丢弃未结算的等待且之后迟到的 `tool/result` 再也减不出数字；多次等待累加；`awaitCalls` 不出现在
wire 里。

复跑测试（需要 zod，用任意 Node 20+ 即可；DSH 自带的那份在
`%USERPROFILE%\.dsh\dsh-runtimes\<runtime>\dependencies\node\bin\node.exe`）：

```powershell
node test\projection.test.mjs
```

客户端渲染用 `react`/`react-dom` 做 SSR 冒烟（`--no-save` 装即可，不进 `package.json`）：

```powershell
npm install --no-save --package-lock=false react@19 react-dom@19
node test\render.test.mjs    # render smoke: closed-state and open-state assertions passed
```

弹窗断言把时钟钉在固定值上：`createdAt = now - 30 分钟`、且 `lastActivityAt = now` 时，弹窗必须
出现 `30分0秒`——证明这个数是从当前时间现算的；随后把 `lastActivityAt` 换到
`createdAt + 10 分钟`（即对话已空闲二十分钟），同一份渲染必须变成 `10分0秒` 且不再出现
`30分0秒`/`20分0秒`——这就是"没人动就不再累加"的回归测试。

扣减的回归测试同样在 `test/render.test.mjs` 里：`llmMs 2分 + toolMs 7分`、`awaitMs 7分` 时，
pill 必须读 `2分0秒 · 工作时长` 且不得出现 `9分0秒`；弹窗多出一行 `已扣除等待回答 7分0秒`；
`awaitMs` 大到把读数压成负数时整颗 pill 不渲染（而不是显示负值）；宿主还是旧 view（没有
`awaitMs` 字段）时退回旧读数而不是 `NaN`。

侧边栏合计另有断言：某一行的 `taskTimer.awaitMs` 必须**先减该行再求和**
（`1小时30分` → `1小时20分`），且实时投影里的等待覆盖检查点缓存里的值。

浏览器侧 pill 的注入结构与官方 `dsh-client-ui-chat` 的 `ActivityPill`/`UsagePill` 完全同构
（同样的 `conversation.composer.dock` slot、同样的 `useProjection` keyed hook）。

侧边栏那一行用同一份 `test/render.test.mjs` 覆盖：`wide=false` 时不渲染、总量为 0 时不渲染、
子会话行被排除、实时投影覆盖列表缓存、`1小时30分 · 对话总时长` 的文案、`user-select: none`
（含 `-webkit-` 前缀）、行内不画图标，以及 12px/18px 的排版。同一份测试还断言了两条弹窗皮肤路径：
样式表缺席时用内置内联样式，样式表挂上后弹窗立刻改用 `.xxxx_panel` 等内置类名、并且不再输出
自己的背景声明。

## 样式对齐（与仪表盘内置 pill 逐项一致）

字体/字号肉眼可见的差异只可能来自"自己发明一套尺寸"。这里不发明：所有数值都抄自
`dsh-client-ui-chat` 的 `StatsPills.module.css` 与 `stat-dialog.module.css`。

| 项目 | 内置 `ActivityPill`/`UsagePill` | 本插件 |
|------|-------------------------------|--------|
| 字号/行高 | `12px / 18px` | 同 |
| 高度 / 内边距 | `24px` / `0 8px` | 同（`gap 6px` 留给前面的时钟图标） |
| 圆角 | `999px` + `corner-shape: round` | 同 |
| 前景 / 底色 | `label-secondary` / `bg-layer-2` | 同 |
| 悬停 / 展开态 | hover 与 `[aria-expanded=true]` 同为 `interactive-bg-hover`，文字保持 `label-secondary` | 同（并排选择器一次写死，展开不额外上一个"选中"底色） |
| 图标 | 每个 pill 一位 primitives 图标（activity 是仪表盘、usage 是数据库），尺寸由 `.pill svg { 14px }` 定 | 时钟 `IconClockOutlineRegular`，pill 与弹窗标题各一位；侧边栏合计行仍纯文字 |
| 弹窗 | `pad 16`、`specific-menu` 面、12/18、6/16 明细栅格 | 同一个类名：运行时读回 ui-chat 的 `stat-dialog.module.css` 哈希类名后直接套用 |
| 弹窗定位 | `useAnchoredPosition`，side top、gap 8、margin 12 | 同（复用同一 primitive） |
| 标签文案顺序 | 数值在前、名称在后，`·` 分隔 | 同（`51分24秒 · 工作时长`） |

因此 `lib/client.js` 不再手写坐标钳制、不手绘 SVG、也不用 `font: inherit`（那会把继承来的
字号带进来，正是之前看起来"字体不一致"的原因）。

## 改动生效范围（排查用）

| 文件 | 生效方式 |
|------|----------|
| `lib/client.js`、`locale/*.json` | 渲染进程侧，重开窗口即读到新代码 |
| `lib/index.js` | 主进程侧，**只有整个 DSH 进程重启才会重新加载** |

判断宿主侧有没有真的换上新代码，看投影检查点缓存
`%USERPROFILE%\.dsh\storages\session_projcache\sessions\<session-id>.json` 里的
`record.rows.taskTimer`：换上新代码后应是 `ver: 4` 与
`{"createdAt": ..., "lastActivityAt": ..., "awaitMs": ...}`。

还有一种更直接的判据：`ver` 低于 4 的旧行会被注册表的版本闸门挡下、按 `stateVersion: 4`
自动重放日志重算，不需要手动清缓存；而**主进程没重启**时投影根本不会重算——此时 wire 里
没有 `awaitMs`，客户端只能按旧的 `llmMs + toolMs` 记账（问句的等待会继续被算成工作）。
所以看到读数还没扣掉等待，先确认托盘里的 DSH 进程是不是整只重启过。
