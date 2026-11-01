# 上架 dshmarketplace.dev：完整操作流程

本文分两半：**你只要做两件事**（给 token、未来偶尔看一眼），其余全部由我执行并回传证据。

---

## 0. 先说清"上架"到底指什么

`dshmarketplace.dev` 是社区站点，独立于 DeepSeek 官方。它有两个面：

| 面 | 地址 | 收录条件 |
| --- | --- | --- |
| 网站目录 | `https://dshmarketplace.dev` | 公开 GitHub 仓库 + `dsh-plugin` topic（或表单送审） |
| 站内索引文件 | `https://dshmarketplace.dev/market/index.json` | **只收 npm 包** |

DSH 内置的"发现"页读的是第二行那个索引。2026-11-01 实测该索引 1728 条，`source.type` 全部是
`npm`，没有一条 git 源——所以**只上 GitHub 会出现在网站上，但不会进 DSH 内置的"发现"页**。
进"发现"页要么有 npm 包，要么自建索引源（见 `PUBLISH.zh.md` §2、§3）。

本次要做的是第一行：先进网站目录，把仓库、README、许可证这些"门面"做对。

---

## 1. 站点的收录规则（2026-11-01 直接读 `https://dshmarketplace.dev/submit` 原文）

- 只收**公开 GitHub 仓库**，用仓库根 URL；私有、已归档、已禁用的项目不能收录。
- **最快的一条路：给仓库打 `dsh-plugin` topic**，下一次同步自动收录，连表单都不用填。
  站点原文：*"Adding that topic to your repository gets you listed on the next sync, with no
  submission needed."*
- 另需 `deepseek-harness` topic（站点在 "Before you open it" 里明确要求两个都加）。
- 卡片上的每个字都来自仓库自身，所以要事先填好：
  - **Repository description** → 卡片摘要（一句话讲能力，不讲实现）；
  - **LICENSE 文件** → 没有许可证会被标成 all-rights-reserved；
  - **README（含安装命令）** → 详情页正文，等于落地页。
  - npm 包可选，有的话安装走 tarball 更快。
- 表单 `Inspect repository` = 人工审核通道，和 topic 自动同步二选一即可。
- **没有 commit 数量门槛**。此前我说"需 ≥10 commits"，在现行 `/submit`、`/about` 页面均读不到，
  以页面为准，此处更正。
- 想进 `awesome-dsh-plugin` 那个社区 registry（DSH 内置市场装插件时读的就是它）是**另一个项目**，
  要单独对 `awesome-dsh-plugin` 提 PR：在 `data/curated.yml` 对应分类下加条目，再 `npm test`。

---

## 2. 你要做的第一件事：给一个 GitHub token（一次性，最短有效期即可）

我在本机查过：`GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT` 全空，`gh` 未安装，`~/.ssh` 下只有
`known_hosts`，没有任何可用于 GitHub 的凭据——所以建仓库、推送、打 topic 这三步我目前一步都做不了，
不是能力问题，是凭据不在机器上。

**生成步骤（约 40 秒）：**

1. 打开 <https://github.com/settings/tokens/new>（Settings → Developer settings →
   Personal access tokens → Tokens (classic) → Generate new token (classic)）。
2. Note 填 `dsh-task-timer 上架`。
3. Expiration 选 **7 days**（用完就过期，不留长期凭据）。
4. Scopes 只勾 **`public_repo`**（在 `repo` 那一组下面；建公开仓库 + 推送 + 打 topic 够用）。
5. 点 Generate，把 `ghp_...` 那串**直接贴给我**（只在这一轮对话里用，我不写进任何文件、
   不写进 `.git/config`、不写进 tarball；用完你可以立刻 Revoke）。

拿到 token 后我会依次执行（全部有回执，不需要你去核对任何东西）：

```powershell
# ① 建仓库（公开，带 description 与 homepage）
POST https://api.github.com/user/repos
{ "name":"dsh-task-timer", "private":false,
  "description":"<package.json 的 description>",
  "homepage":"https://gitee.com/sunxiaochuan2588000/dsh-task-timer" }

# ② 打两个 topic
PUT  https://api.github.com/repos/ShuaihuiMou/dsh-task-timer/topics
{ "names":["dsh-plugin","deepseek-harness"] }

# ③ 推 main（token 只出现在这一条命令的 URL 里）
git remote add github "https://ShuaihuiMou:<token>@github.com/ShuaihuiMou/dsh-task-timer.git"
git push github main

# ④ 自证：确认仓库公开、description、topics、文件树、LICENSE 都到位
GET https://api.github.com/repos/ShuaihuiMou/dsh-task-timer
GET https://api.github.com/repos/ShuaihuiMou/dsh-task-timer/topics
GET https://api.github.com/repos/ShuaihuiMou/dsh-task-timer/contents/
```

我会把 ④ 的原始返回贴给你，而不是让你自己去数。

---

## 3. 你要做的第二件事：等同步（或催一次）

打完 `dsh-plugin` topic 后，站点下次同步会自动收录。想立刻确认，用站点表单把仓库 URL 粘一次
（`Inspect repository` 只读公开元数据，不发任何东西）。收录后卡片上应该是：

- 标题：`dsh-task-timer`
- 摘要：仓库 description
- 许可证：MIT
- 正文：README 渲染结果

这几项我在推送前会先本地自检一遍（description 是否是一句话、LICENSE 是否在根目录、README 的安装
命令是否可直接复制运行），不合格就不推。

---

## 4. 可选：提交 commit 的身份

现在 Gitee 仓库的提交身份是 `牟浪松 <17036496+sunxiaochuan2588000@user.noreply.gitee.com>`
（仓库局部配置）。推到 GitHub 时这串身份会原样保留——**不会**把你的 QQ 邮箱带出去。
GitHub 侧的 noreply 地址我不猜（`<id>+<login>@users.noreply.github.com` 里的 id 需要账号信息），
除非你要求，否则不改。

---

## 5. 之后的版本更新怎么办

商店不做"升级"：新版本要么卸载重装，要么按精确 spec 装。所以每次发版是三步：

1. 改 `package.json` 的 `version`，在 `market/index.json` 追加一条（`source.commit` 指向本次提交的
   40 位 SHA，`publishTimestamp` 是 unix 秒）；
2. 推 Gitee（自建索引源用）与 GitHub（网站目录用）；
3. 用户侧：`dsh plugin --profile desktop add <精确 spec>` 覆盖安装，然后重启 DSH。

索引有 10 分钟缓存，刷新按钮能绕过缓存。这段在 `PUBLISH.zh.md` §1、§3 有完整命令。
