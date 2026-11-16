// 由 scripts/build-guide.mjs 从 TUTORIAL.md 生成，请改 TUTORIAL.md 后重新生成（npm run build:guide）
/* eslint-disable */

export interface GuideTocItem {
  id: string
  text: string
}

export const guideToc: GuideTocItem[] = [
  {
    "id": "guide-s1",
    "text": "1. 两个入口，一个键"
  },
  {
    "id": "guide-s2",
    "text": "2. 快捷键"
  },
  {
    "id": "guide-s3",
    "text": "3. 收藏"
  },
  {
    "id": "guide-s4",
    "text": "4. 置顶（Pin）"
  },
  {
    "id": "guide-s5",
    "text": "5. AI"
  }
]

export const guideHtml = "<blockquote>\n<p>一页看完：<strong>快捷键、收藏、置顶（Pin）、AI</strong>。剩下的自己摸，忘了回来翻。</p>\n<p>三种看法一样：App 内「设置 → 关于 → 使用教程」（第一次启动自动弹）、网页版 <a href=\"https://maiknote.91kfc.vip/guide.html\">https://maiknote.91kfc.vip/guide.html</a>、仓库里的 <a href=\"https://github.com/Aprilming/maiknote/blob/main/TUTORIAL.md\">TUTORIAL.md</a>。</p>\n</blockquote>\n<h2 id=\"guide-s1\">1. 两个入口，一个键</h2>\n<ul>\n<li><strong>菜单栏图标</strong>（右上角那个小笔记本）：左键叫出 / 收起主窗口，右键有「显示主窗口 / 使用教程 / 退出 MaikNote」。窗口收起来、看着像「应用没了」的时候，点它就回来了。</li>\n<li><code>Option + Cmd + A</code>：唤出 / 收起。别处点一下它就自动收走，不留窗口在桌面上。</li>\n</ul>\n<p>Dock 里没有图标是故意的——这是个随手唤出的浮窗应用。所以菜单栏那颗图标，记住它在。</p>\n<h2 id=\"guide-s2\">2. 快捷键</h2>\n<p>记这 8 个就够了，全部可在 <strong>设置 → 快捷键</strong> 改：</p>\n<div class=\"doc-table\"><table>\n<thead>\n<tr>\n<th>快捷键</th>\n<th>干什么</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td><code>Option + Cmd + A</code></td>\n<td>显示 / 隐藏（全局，应用在后台也生效）</td>\n</tr>\n<tr>\n<td><code>Cmd + N</code></td>\n<td>新建笔记</td>\n</tr>\n<tr>\n<td><code>Cmd + F</code></td>\n<td>搜标题和正文</td>\n</tr>\n<tr>\n<td><code>Cmd + [</code> / <code>Cmd + ]</code></td>\n<td>上一条 / 下一条笔记（触摸板双指左右滑动同效）</td>\n</tr>\n<tr>\n<td><code>Cmd + Shift + P</code></td>\n<td>置顶 / 取消置顶</td>\n</tr>\n<tr>\n<td><code>Cmd + Shift + D</code></td>\n<td>钉到桌面 / 收回</td>\n</tr>\n<tr>\n<td><code>Cmd + Backspace</code></td>\n<td>删除（进回收站，能捞回来）</td>\n</tr>\n<tr>\n<td><code>Esc</code></td>\n<td>关搜索、从设置返回</td>\n</tr>\n</tbody>\n</table></div>\n<p>顺手记两个不是快捷键的：<strong>行首输 <code>/</code></strong> 出命令菜单，<strong><code>[[</code></strong> 插笔记链接。</p>\n<h2 id=\"guide-s3\">3. 收藏</h2>\n<ul>\n<li>左边文件列表里<strong>右键笔记 → 收藏</strong>；</li>\n<li>收藏的笔记集中在侧栏顶部「收藏笔记」分组，随点随开；</li>\n<li>鼠标贴到屏幕边缘的白条上，会滑出收藏面板（快捷键默认没设，想用去设置里绑一个）。</li>\n</ul>\n<h2 id=\"guide-s4\">4. 置顶（Pin）</h2>\n<ul>\n<li><code>Cmd + Shift + P</code> 或标题栏那个图钉：置顶后窗口<strong>不再失焦自动收起</strong>，适合边查边写；</li>\n<li>取消置顶后是「继续显示」还是「直接隐藏」，在 <strong>设置 → 窗口</strong> 里选；</li>\n<li>想让笔记常驻桌面当便签：<code>Cmd + Shift + D</code> 钉成桌面卡片，能在桌面上勾待办。</li>\n</ul>\n<h2 id=\"guide-s5\">5. AI</h2>\n<p><strong>先配一次</strong>：设置 → AI 设置，填 API URL（默认 DeepSeek，OpenAI 格式都兼容）、API Key、模型。</p>\n<p><strong>怎么用</strong></p>\n<ol>\n<li>选中文字再唤 AI，只改这一段；不选就处理整篇。</li>\n<li>右键 → 挑一个助手（自带「AI 优化」等模板，也能自己加）。</li>\n<li>结果先给你看，再决定：插入原文之后 / 替换选中 / 替换全文 / 丢掉。</li>\n<li>已经写进去的，<code>Cmd + Z</code> 能撤。</li>\n</ol>\n<p><strong>进阶两句</strong></p>\n<ul>\n<li>自定义助手：设置 → AI 设置 → 添加助手，写名称 + 提示词，需要查资料就勾联网（要百度 AppBuilder Key）。</li>\n<li>空行输 <code>/ip</code>，直接插入本机地址和出口 IP 归属地。</li>\n</ul>"
