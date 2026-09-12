# Daily Paper

按日期和研究方向浏览论文推荐的阅读网页。英文界面与原文摘要，中文简介和推荐理由，支持数学公式。网站展示最近 7 个自然日；较早内容继续保存在 [content](content/) 中。

## 文件分工

| 文件 | 作用 | 日常是否修改 |
| --- | --- | --- |
| `content/YYYY-MM-DD.json` | 每日论文与推荐内容 | 是 |
| `site.config.json` | 方向 ID、名称与顺序、展示天数 | 调整方向或设置时 |
| `site/index.html`、`site/style.css` | 固定页面结构与样式 | 改版时 |
| `site/app.js` | 日期切换、方向筛选和摘要交互 | 修改功能时 |
| `scripts/` | 内容校验、公式排版和最近 7 天构建 | 修改功能时 |

内容格式见 [填写说明](content/README.md)。新增方向只需配置 ID、名称和顺序，再由内容引用 ID；普通方向仅在选中日期有论文时出现，Optimization Frontiers 始终保留。方向菜单依照配置顺序排列，同一论文可以有多个方向。

## 本地运行

需要 Node.js 20 或更新版本。

```sh
npm ci
npm test
npm run build
python3 -m http.server 8770 --bind 127.0.0.1 --directory dist
```

构建时使用 Asia/Singapore 当天日期，只读取当天及前 6 天的内容。缺少日期显示尚无日报，不当成无合适推荐；不会用更早的内容补足 7 份日报。检查失败先修正内容再构建，原输出保持不变。构建成功后整个输出目录替换，旧页面不会残留，原始历史文件不删除。

可用 `npm run build -- --date 2026-09-12` 检查某个日期窗口。仅 `dist/` 是待部署的网站；不要把整个仓库或演示输出作为 Pages 产物上传。推送到 `main` 后，GitHub Actions 会测试并构建网站，再将 `dist/` 发布到 GitHub Pages。

## 布局预览

```sh
npm run preview:build
python3 -m http.server 8771 --bind 127.0.0.1 --directory .preview
```

演示输出有明确提示、没有真实论文链接，保存在 Git 忽略的 `.preview/`，示例不会进入正常构建。`content/` 保存每日公开推荐；网页模板位于 `site/`，日常只需填写内容文件。

公式使用固定版本 [KaTeX](https://katex.org/docs/browser.html) 在构建时排版，CSS 和字体随网站发布；浏览时不需要连接第三方公式 CDN。支持范围内的语法错误会阻止构建，需核实原文并修正。测试与浏览器检查用于确认日期切换、方向筛选、窄屏布局和公式显示。
