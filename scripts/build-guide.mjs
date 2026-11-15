// 把 TUTORIAL.md 生成成官网上的教程页 site/guide.html（零依赖，复用站点样式）。
// 用法：node scripts/build-guide.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

let source = readFileSync(join(root, 'TUTORIAL.md'), 'utf8')

const titleMatch = source.match(/^#\s+(.+)$/m)
const title = titleMatch ? titleMatch[1].trim() : 'MaikNote 使用教程'
// 去掉 h1 与手写的「目录」段（页面自带侧边目录）
source = source.replace(/^#\s+.+\n/, '')
source = source.replace(/^##\s*目录\s*\n[\s\S]*?(?=^##\s)/m, '')

let html = md.render(source)

// 给 h2 编号锚点，同时收集目录
const toc = []
let n = 0
html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner) => {
  n += 1
  const id = 'guide-s' + n
  const text = inner.replace(/<[^>]+>/g, '').trim()
  toc.push({ id, text })
  return '<h2 id="' + id + '">' + inner + '</h2>'
})

html = html.replace(/<table>/g, '<div class="doc-table"><table>').replace(/<\/table>/g, '</table></div>')
// 指向仓库内文件的相对链接，在网页上换成 GitHub 地址
html = html.replace(/href="TUTORIAL\.md"/g, 'href="https://github.com/Aprilming/maiknote/blob/main/TUTORIAL.md"')

const tocHtml = toc
  .map((t) => '        <a href="#' + t.id + '">' + t.text + '</a>')
  .join('\n')

const page = `<!DOCTYPE html>
<!-- 由 scripts/build-guide.mjs 从 TUTORIAL.md 生成，改内容请改 TUTORIAL.md 后重新生成 -->
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{TITLE} — MaikNote</title>
<meta name="description" content="MaikNote 使用教程：安装、上手、写笔记、窗口玩法、AI、数据位置、设置与快捷键，随时回来翻。" />
<link rel="icon" href="assets/img/icon-32.png" />
<link rel="apple-touch-icon" href="assets/img/icon-128.png" />
<link rel="stylesheet" href="assets/styles.css?v=4" />
<style>
  .doc-shell {
    display: grid;
    grid-template-columns: 236px minmax(0, 1fr);
    gap: 52px;
    max-width: 1120px;
    margin: 0 auto;
    padding: 44px 24px 120px;
  }
  .doc-toc { position: sticky; top: 78px; align-self: start; font-size: 14px; }
  .doc-toc-title {
    margin: 0 0 10px; padding: 0 10px;
    font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint);
  }
  .doc-toc nav { display: flex; flex-direction: column; gap: 2px; }
  .doc-toc a {
    display: block; padding: 6px 10px; border-radius: 9px;
    color: var(--muted); line-height: 1.45;
    border-left: 2px solid transparent;
    transition: color .18s, background .18s, border-color .18s;
  }
  .doc-toc a:hover { color: var(--text); background: var(--panel); }
  .doc-toc a.is-active { color: var(--text); border-left-color: var(--accent); background: var(--panel); }
  .doc-top {
    display: inline-block; margin: 18px 0 0 10px; font-size: 13px; color: var(--faint);
  }
  .doc-top:hover { color: var(--accent); }

  .doc { min-width: 0; }
  .doc h1 { font-size: 34px; line-height: 1.25; margin: 0 0 10px; letter-spacing: -.01em; }
  .doc h2 {
    font-size: 22px; margin: 46px 0 14px; padding-top: 22px;
    border-top: 1px solid var(--line-soft); scroll-margin-top: 84px;
  }
  .doc h2:first-of-type { border-top: none; padding-top: 0; margin-top: 34px; }
  .doc h3 { font-size: 16.5px; margin: 26px 0 10px; color: var(--text); }
  .doc p { margin: 12px 0; color: var(--muted); }
  .doc li { color: var(--muted); margin: 5px 0; }
  .doc li > strong, .doc p > strong { color: var(--text); }
  .doc ul, .doc ol { padding-left: 22px; margin: 12px 0; }
  .doc a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .doc a:hover { text-decoration-color: var(--accent); }
  .doc code {
    background: rgba(255, 255, 255, .07); border: 1px solid var(--line-soft);
    padding: 1px 6px; border-radius: 6px; color: var(--text); white-space: nowrap;
  }
  html[data-theme="light"] .doc code { background: rgba(0, 0, 0, .05); }
  .doc pre {
    background: #0b0d12; border: 1px solid var(--line); border-radius: 14px;
    padding: 16px 18px; overflow-x: auto; margin: 16px 0; font-size: 13px; line-height: 1.6;
  }
  html[data-theme="light"] .doc pre { background: #f2f3f6; }
  .doc pre code { background: none; border: none; padding: 0; white-space: pre; }
  .doc blockquote {
    margin: 16px 0; padding: 12px 18px; border-left: 3px solid var(--accent);
    background: var(--panel); border-radius: 0 12px 12px 0; color: var(--muted);
  }
  .doc blockquote p { margin: 4px 0; }
  .doc-table { overflow-x: auto; margin: 16px 0; }
  .doc table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
  .doc th, .doc td { border-bottom: 1px solid var(--line-soft); padding: 9px 12px; text-align: left; color: var(--muted); }
  .doc th { color: var(--text); font-weight: 600; white-space: nowrap; }
  .doc tr:last-child td { border-bottom: none; }
  .doc hr { border: none; border-top: 1px solid var(--line-soft); margin: 28px 0; }

  @media (max-width: 900px) {
    .doc-shell { grid-template-columns: 1fr; gap: 26px; padding-top: 26px; }
    .doc-toc { position: static; border: 1px solid var(--line); border-radius: 14px; padding: 14px 10px; background: var(--panel); }
    .doc-toc nav { flex-direction: row; flex-wrap: wrap; }
    .doc-toc a { border-left: none; background: var(--panel-solid); }
    .doc h1 { font-size: 27px; }
  }
</style>
</head>
<body class="doc-body">

<header class="nav" id="nav">
  <a class="brand" href="index.html">
    <img src="assets/img/icon-128.png" alt="MaikNote 图标" width="26" height="26" />
    <span>MaikNote</span>
  </a>
  <nav class="nav-links">
    <a href="index.html#features">功能</a>
    <a href="index.html#ai">AI</a>
    <a href="index.html#shortcuts">快捷键</a>
    <a href="index.html#download">下载</a>
    <a href="guide.html" class="is-current">教程</a>
  </nav>
  <div class="nav-actions">
    <button class="icon-btn" id="themeToggle" aria-label="切换主题" title="切换浅色 / 深色">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path class="i-moon" d="M12.7 3a8.5 8.5 0 1 0 8.3 10.6 6.8 6.8 0 0 1-8.3-10.6Z" fill="currentColor"/><circle class="i-sun" cx="12" cy="12" r="4.2" fill="currentColor"/></svg>
    </button>
    <a class="btn btn-sm" href="index.html#download">下载</a>
  </div>
</header>

<main class="doc-shell">
  <aside class="doc-toc">
    <p class="doc-toc-title">目录</p>
    <nav id="docToc">
{TOC}
    </nav>
    <a class="doc-top" href="#top">↑ 回到顶部</a>
  </aside>

  <article class="doc" id="top">
{BODY}
  </article>
</main>

<footer class="wrap" style="padding: 0 24px 60px; color: var(--faint); font-size: 13px;">
  <p>教程内容与 App 版本同步更新；发现对不上的地方，直接在 GitHub 提 issue。</p>
</footer>

<script src="assets/main.js"></script>
<script>
  (() => {
    const links = Array.from(document.querySelectorAll('#docToc a'));
    const heads = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    if (!heads.length || !('IntersectionObserver' in window)) return;
    const mark = (id) => links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + id));
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) mark(visible[0].target.id);
    }, { rootMargin: '-84px 0px -70% 0px', threshold: 0 });
    heads.forEach((h) => io.observe(h));
  })();
</script>
</body>
</html>
`

const out = page
  .replace('{TITLE}', () => title)
  .replace('{TOC}', () => tocHtml)
  .replace('{BODY}', () => html.trim())

writeFileSync(join(root, 'site/guide.html'), out)

// 应用内用的同一份内容：设置 → 关于 → 使用教程 打开的就是它
const ts = [
  '// 由 scripts/build-guide.mjs 从 TUTORIAL.md 生成，请改 TUTORIAL.md 后重新生成（npm run build:guide）',
  '/* eslint-disable */',
  '',
  'export interface GuideTocItem {',
  '  id: string',
  '  text: string',
  '}',
  '',
  'export const guideToc: GuideTocItem[] = ' + JSON.stringify(toc, null, 2),
  '',
  'export const guideHtml = ' + JSON.stringify(html.trim()),
  '',
].join('\n')
writeFileSync(join(root, 'src/components/Guide/guideContent.generated.ts'), ts)

console.log('site/guide.html 已生成：' + toc.length + ' 个章节，' + out.length + ' 字符')
console.log('src/components/Guide/guideContent.generated.ts 已生成：' + ts.length + ' 字符')
