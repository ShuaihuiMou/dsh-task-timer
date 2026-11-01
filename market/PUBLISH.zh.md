# 把 dsh-task-timer 上架到 DSH 插件市场

DSH 官方**没有**中心化商店，但社区有一个事实上的主市场：**dshmarketplace.dev**。它的目录页收录
15,545 条，同时对外发布一份 format 1 索引 `https://dshmarketplace.dev/market/index.json`——
本机 profile 的 `plugin-market.indexes` 里配的就是它。所以「上架」有两条路，不互斥：

- **路 A：进 dshmarketplace.dev**——目录页和 DSH 的「发现」页都从它来，门槛见第 0 节；
- **路 B：自建索引源**——自己托管一份 format 1 索引，使用者手动添加 URL。完全自主、无审核，
  本目录的 [`index.json`](index.json) 就是产物，已用运行时内置的
  `@deepseek-ai/dsh-plugin-market-index` 校验通过。

路 B 负责「今天就能装」，路 A 负责「别人搜得到」。

## 0. 主市场 dshmarketplace.dev 的准入规则

规则由站点自己在 <https://dshmarketplace.dev/api-docs> 和 <https://dshmarketplace.dev/submit> 公布，
以下均已逐条核过：

**只认 GitHub 仓库。** 目录同步 GitHub 的 `dsh-plugin` topic 和社区 registry `awesome-dsh-plugin`，
安装命令形如 `dsh plugin --profile desktop add github:owner/repo` 或 npm 包名。全量 15,545 条里来源
只有 github/npm，**没有一条 Gitee 仓库**；手动提交表单也只接受 GitHub 仓库 URL。

**三条准入门槛**（缺一不可）：

1. 声明自己是 DSH 插件：`package.json` 里有 `dsh` 清单、或依赖 `@deepseek-ai/*`/Cordis、
   或存在 `cordis.patch.yml`；
2. **≥ 10 个 commit**（沿用 awesome-dsh-plugin 的标准，用来把脚手架和真作品区分开）；
3. 仓库有 description（空描述的仓库只是个链接，会被丢掉）。

本包满足第 1 条（`dsh` 清单 + `cordis.patch.yml`）和第 3 条；commit 数需要自然累积到 10。

**每条安装命令都在一次性容器里实装过**（`installCheck`）才上架，并记录验证所用的 dsh 版本
（`installCheckDsh`）——dsh 0.2 起会拒绝为其它版本构建的插件，所以 `engines.dsh` 必须覆盖它实际跑的那个版本。

**想出现在 DSH 的「发现」页，必须有 npm 包。** `/market/index.json` 实测 1728 条**全部**是
`source.type: "npm"`；站点的口径是「从源码装的插件不在里面，因为源码安装要先批准构建，发现页做不到」。
没有 npm 账号时，GitHub 仓库能让插件进站点目录页、也能用 `github:owner/repo` 装，但进不了「发现」页。

## 1. 发布来源：npm 或 git

索引里的 `versions[].source` 支持两种来源，二选一即可：

**A. git 源（本仓库索引当前用的就是这条）**——不需要 npm 账号，公开仓库能匿名 clone 就行：

```json
"source": {
  "type": "git",
  "url": "https://gitee.com/sunxiaochuan2588000/dsh-task-timer",
  "commit": "<40 位小写 commit SHA>"
}
```

市场会拼成 `git+<url>.git#<commit>` 交给 pnpm 安装（`marketInstallTarget`），所以 `commit` 必须是
**已经推上去、且包含完整插件代码**的提交；发新版就是推代码 → 把 `commit` 换成新的 SHA → 推索引。

**B. npm 源**——`package.json` 已具备市场所需字段（`engines.dsh`、`keywords`，且没有 `private`）：

```bash
cd dsh-task-timer
npm adduser                 # 或 npm login
npm publish --access public
```

```json
"source": { "type": "npm" }
```

- 只有真的发布成功后才能写 `type: "npm"`，否则装到一半会 `ERR_PNPM_FETCH_404`。
- `engines.dsh` 是市场判断兼容性的唯一依据；本包声明 `>=0.2.1-rc.5`，与当前运行时不冲突。
- 本地安装（`link:`）也会走同一套兼容性检查，声明范围必须包含当前 dsh 版本，否则会被拦下。

## 2. 托管索引

`index.json` 需要放在一个 **http/https** URL 上，URL 不能带 query、fragment 或凭据。
可行做法：

- 公开仓库的 raw 链接，但**必须是直接 200 的地址**：市场抓取器用 `redirect: "error"`
  取索引（`dsh-plugin-market/lib/index.js` 的 `fetchIndex`），遇到 302 直接判失败。
  Gitee 的 `https://gitee.com/<owner>/<repo>/raw/<ref>/<path>` 是 302，不能用；本仓库实测可用的直连地址是：
  `https://raw.giteeusercontent.com/sunxiaochuan2588000/dsh-task-timer/raw/main/market/index.json`
- GitHub 的 `raw.githubusercontent.com` 本身就是 200，无此问题
- Cloudflare Pages / Vercel 等静态托管
- 本机临时调试：`npx http-server market -p 8080` →
  `http://127.0.0.1:8080/index.json`（DSH 关掉后就失效）

每发布一个新版本，在 `plugins[0].versions` 里**追加**一条（新版本放前面或后面都行，读取时按 SemVer 降序排）：

```json
{
  "version": "1.3.1",
  "publishTimestamp": 1793542000,
  "source": {
    "type": "git",
    "url": "https://gitee.com/sunxiaochuan2588000/dsh-task-timer",
    "commit": "<该版本对应的 40 位小写 SHA>"
  },
  "engines": { "dsh": ">=0.2.1-rc.5" }
}
```

字段约束（由校验器强制）：

- `version` 必须是精确 SemVer；同一插件内不能重复
- `publishTimestamp` 是 Unix **秒**，整数，`[0, 10^11)`
- `source.type` 只能是 `npm`（可选 `registry`）或 `git`（`url` 必须公开 https、至少两段路径、不能是 tarball；
  `commit` 必须是 40 位小写 SHA；可选 `path` 指子目录）
- `metadata.category` / `labels` 里的 id 必须先在根 `metadata` 中声明
- `icon` 只能是 https 或与索引同源，或 `data:` base64（解码后 ≤ 32 KiB）
- 顶层 `title` 若写成多语言对象，**必须含 `en`**

## 3. 添加索引源

1. 插件页 → **发现**（如果没有这个标签页，先在 插件 → 实验性插件 里启用
   `@deepseek-ai/dsh-experimental-plugin-market-bundle`，本机 profile 已启用）
2. 空状态点 **添加索引源**（或工具栏 插件市场 → **管理索引源…**）
3. 粘贴索引 URL → 保存
4. 刷新按钮读一次；成功后索引缓存 10 分钟（`cacheTtlMs`），期间改动不生效

## 已知限制

- **没有升级操作**：有新版本只显示「有新版本」，要装新版本得先卸载（或直接装精确 spec）。
- **索引不签名**：索引本身不可信，真正生效的是安装包里 `package.json` 的 `dsh` 清单。
- 不同索引源之间可能存在同名插件，条目页面会显示它来自哪个插件市场。
