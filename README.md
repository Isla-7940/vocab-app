# AI 背单词

按个人英语水平自动调整训练内容的背单词网页应用。培训演示项目。

- 作者：iteaisla
- 在线地址：https://isla-7940.github.io/vocab-app/ （仓库名为 `vocab-app` 时）

## 功能

- 水平测试：30 题，确定起始难度
- 词库切换：大学英语四级、六级、雅思，进度独立保存
- 选择题练习、单词发音、错词本
- 间隔复习与难度自动调整
- AI 学习报告：分析答题统计，给出薄弱点和学习建议
- AI 例句：为错词生成例句、翻译和记忆提示

学习记录仅保存在本机浏览器，无需注册。设计说明见 [DESIGN.md](DESIGN.md)。

## 本地运行

页面通过 `fetch` 读取词库，需要以本地服务器方式打开：

```bash
python -m http.server 8765
```

然后访问 http://localhost:8765 。

## 部署 AI 接口代理

AI 功能通过 `worker/` 中的 Cloudflare Worker 调用 DeepSeek，密钥只保存在 Cloudflare 中。前提：`t-i.cc` 已托管在 Cloudflare。

1. `worker/wrangler.toml` 中的 `ALLOWED_ORIGINS` 已设为 `https://isla-7940.github.io`，更换 GitHub 账号时需同步修改。
2. 在 `worker/` 目录下执行：

   ```bash
   npx wrangler login
   npx wrangler secret put API_KEY
   npx wrangler deploy
   ```

   执行 `secret put` 时按提示粘贴 DeepSeek API Key，输入内容不会显示。

   Windows PowerShell 提示“禁止运行脚本”时，将 `npx` 改为 `npx.cmd`。
3. 可选：执行 `npx wrangler secret put ACCESS_CODE` 设置访问口令，同事首次使用 AI 功能时输入。

接口地址为 `https://vocab-api.t-i.cc`，配置在 `js/config.js`。

### 本地调试 Worker

将 `worker/.dev.vars.example` 复制为 `worker/.dev.vars` 并填写密钥，然后：

```bash
npx wrangler dev
```

访问 http://localhost:8765/?api=local ，页面会改为调用本地 Worker。

## 生成词库

词库数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议）。下载 `ecdict.csv` 后运行：

```bash
python scripts/build_words.py <ecdict.csv 路径>
```

生成结果写入 `data/` 目录。`ecdict.csv` 约 66 MB，不要放入本仓库。

## 发布前端

仓库 Settings → Pages → Deploy from a branch → `main` / `(root)` → Save。

通过网页上传文件时 `.gitignore` 不生效，请勿上传 `.csv`、`.dev.vars` 等文件。
