# 把 dsh-task-timer 上架到 DSH 插件市场

DSH 目前**没有官方插件市场**：没有中心化的提交入口，也没有审核流程。所谓「插件市场」是
**索引源（index source）** 模型——插件页的「发现」标签页只列出用户自己添加的索引 URL。
所以「上架」= 做三件事：

1. 把包发布到 npm（或一个公开的 Git 仓库）；
2. 在某个 http(s) 地址上托管一份 **format 1** 的索引 JSON；
3. 让使用者在「插件 → 发现 → 添加索引源」里填那个 URL。

本目录的 [`index.json`](index.json) 就是第 2 步的产物，已用运行时内置的
`@deepseek-ai/dsh-plugin-market-index` 校验通过。

## 1. 发布 npm 包

`package.json` 已经具备市场所需字段（`engines.dsh`、`keywords`，且已移除 `private`）。

```bash
cd dsh-task-timer
npm adduser                 # 或 npm login
npm publish --access public
```

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
  "version": "1.0.1",
  "publishTimestamp": 1793535268,
  "source": { "type": "npm" },
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
