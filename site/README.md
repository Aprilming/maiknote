# MaikNote 官网（site/）

独立的产品展示站，与应用源码完全解耦：纯静态 HTML + CSS + JS，**零构建、零依赖、无第三方 CDN**，
双击 `index.html` 或丢到任意静态托管即可访问。

## 目录

```
site/
├── index.html                 # 单页：Hero / 功能 / 截图 / AI / 快捷键 / 下载 / FAQ
├── assets/
│   ├── styles.css             # 设计令牌 + 深/浅主题
│   ├── main.js                # 主题切换、复制命令、最新版本解析
│   └── img/                   # 产品截图、AI 演示 GIF、应用图标
└── README.md
```

## 本地预览

```bash
cd site && python3 -m http.server 4173
# 打开 http://127.0.0.1:4173
```

直接 `open site/index.html` 也能看，只是浏览器会限制 `file://` 下的部分能力（如剪贴板 API 降级）。

## 部署

### GitHub Pages（已配好流水线）

`.github/workflows/pages.yml` 在 `site/` 有改动推送到 `main` 时自动发布。
首次使用需在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

### 任意静态托管

把 `site/` 目录整个上传到 Vercel / Netlify / Cloudflare Pages / 对象存储即可。
所有资源都是相对路径（`assets/...`），挂在子路径下也能正常显示。


### 自有服务器 jpp（Docker + 宿主机 Nginx）

线上实例：https://maiknote.91kfc.vip （容器 `maiknote-site` 监听 127.0.0.1:8099，宿主机 Nginx 反代 + 通配证书 `/etc/nginx/ssl/91.pem`）。

```bash
# 1. 本地上传（只传 site/ 目录，约 3MB）
sftp/rsync -> /opt/maiknote-site

# 2. 服务器上构建并启动（Rocky 9 + Docker 29）
cd /opt/maiknote-site && docker build -t maiknote-site:latest .
docker run -d --name maiknote-site --restart unless-stopped \
  -p 127.0.0.1:8099:80 maiknote-site:latest

# 3. 宿主机反代（/etc/nginx/conf.d/maiknote.conf）
#    server_name maikdown.91kfc.vip maiknote.91kfc.vip;
#    proxy_pass http://127.0.0.1:8099;
nginx -t && systemctl reload nginx

# 4. 更新内容（改完再跑一次，容器换新镜像）
cd /opt/maiknote-site && docker build -t maiknote-site:latest . \
  && docker restart maiknote-site
```

- **端口**：容器内 80（`ENV PORT=80`），宿主机只绑 `127.0.0.1:8099`，不对公网暴露。
- **证书**：沿用服务器上的通配证书 `*.91kfc.vip`，新增子域不需要重新签。
- **DNS**：子域需在 Cloudflare 上有 A 记录指向 `216.23.81.140`（橙云可开）。`maiknote` 已有记录，`maikdown` 待加。
- **验证**：`curl -s https://maiknote.91kfc.vip/healthz` 应返回 `ok`；`docker inspect --format '{{.State.Health.Status}}' maiknote-site` 为 `healthy`。

## 下载按钮怎么工作

**全站只有一个下载区**（`#download`，两个架构卡片）。顶部 Hero 和底部 CTA 的「下载 macOS 版」只是锚点到 `#download`，不再重复放 DMG 按钮。

`#download` 里的按钮默认指向 `https://github.com/Aprilming/maiknote/releases/latest`。
页面加载后，`assets/main.js` 会请求 GitHub Releases API，按架构匹配最新产物并改写链接：

| 按钮 | 匹配规则 |
|:---|:---|
| Apple Silicon | `*_aarch64.dmg`（兼容 `*arm64.dmg`） |
| Intel | `*_x64.dmg`（兼容 `*x86_64.dmg`） |

同时把页面上的 `<span data-version>` 更新为最新 tag。
API 不可达 / 触发速率限制时静默回退到发布页，不报错、不空白。

已缓存在 `sessionStorage` 的 `mn-release` 键里，同一次会话不重复请求；调试时清掉即可：
`sessionStorage.removeItem('mn-release')`。

## 改内容时看这里

- **版本号只来自 GitHub**：HTML 里**不写死任何版本号**。三处 `data-ver-wrap`（Hero 徽章、下载区标题、页脚）默认 `hidden`，`main.js` 拿到 `releases/latest` 的 `tag_name` 后写入 `[data-version]` 并取消隐藏；API 挂掉或受限时整段版本信息不显示，按钮回落到 `/releases/latest`。改文案搜 `data-ver-wrap`。
- **截图**：均为 macOS 实机窗口截图（WebP，原生 2070×1356，不缩放，1x/2x 屏都不糊），`#shots` 里 `.shots-grid` 是八张卡片，首张 `.is-lead` 通栏。换图只改 `assets/img/` 下同名 `.webp`（保持 2070×1356）；新增截图复制一段 `<figure class="window shot-card">`（标题栏 `<span>` 写标签，`img` 带 `width="2070" height="1356"`）。
- **比例锁死**：`.shot-card img` 上写了 `aspect-ratio: 2070 / 1356`，任何容器/缩放都不会把截图拉变形；换图若比例不是 2070:1356，同步改这个值。
- **缓存**：`index.html` 引用 `assets/styles.css?v=`、`assets/main.js?v=`、`assets/img/*.webp?v=`。改样式或图后把 `?v=` 的数字 +1，避免用户看到旧缓存。
- **快捷键表**：`#shortcuts` 里 `.key-row`，一条一个 `<div>`。
- **主题**：默认跟随系统，右上角按钮可切换并记住选择（`localStorage.mn-theme`）。
  配色全部在 `styles.css` 顶部的 CSS 变量里，改 `:root`（深色）与 `html[data-theme="light"]` 两处即可。
- **配色对比度**：正文 muted 文本用 `--muted`，不要在小字上直接用 `--faint`。

## 内容口径

文案取自 `README.md`，改动功能描述时两边保持一致：中文站、版本号 `0.10.21`、macOS 12+、双架构 DMG、
GPL-2.0 与「个人使用」授权说明。