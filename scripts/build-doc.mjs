#!/usr/bin/env node
// 从《NocoProject 产品与技术方案.md》生成网页。
// 用法：node scripts/build-doc.mjs
// 产物：
//   NocoProject 产品与技术方案.html   本地可直接打开的完整网页
//   dist/nocoproject-plan.html        用于发布为 Artifact 的页面片段（不含 doctype/html/body）
// Markdown 是唯一来源，改完 md 后重新运行本脚本即可，两份网页永远一致。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mdPath = join(root, 'NocoProject 产品与技术方案.md');
const localOut = join(root, 'NocoProject 产品与技术方案.html');
const artifactOut = join(root, 'dist', 'nocoproject-plan.html');

const markedCandidates = [
  join(root, 'nocoproject/node_modules/.pnpm/marked@4.3.0/node_modules/marked/lib/marked.esm.js'),
  join(root, 'nocoproject/node_modules/marked/lib/marked.esm.js'),
];
const markedPath = markedCandidates.find((p) => existsSync(p));
if (!markedPath) {
  console.error('找不到 marked，请在 nocoproject/ 目录执行 pnpm install，或调整 markedCandidates。');
  process.exit(1);
}
const { marked } = await import(pathToFileURL(markedPath).href);

const md = readFileSync(mdPath, 'utf8');
const versionMatch = md.match(/^> 版本：(.+)$/m);
const versionLine = versionMatch ? versionMatch[1].trim() : '';

// ---------- 渲染 ----------
const toc = [];
const counters = [0, 0, 0, 0];
const renderer = new marked.Renderer();

renderer.heading = (text, level) => {
  if (level === 1) return `<h1>${text}</h1>`;
  counters[level - 2] += 1;
  for (let i = level - 1; i < counters.length; i += 1) counters[i] = 0;
  const id = 's-' + counters.slice(0, level - 1).filter((n) => n > 0).join('-');
  if (level <= 3) toc.push({ level, id, text: text.replace(/<[^>]+>/g, '') });
  return `<h${level} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${level}>`;
};

renderer.code = (code, lang) => {
  if (lang === 'mermaid') return `<div class="diagram"><pre class="mermaid">${escapeHtml(code)}</pre></div>`;
  const cls = lang ? ` class="lang-${lang}"` : '';
  return `<div class="codewrap"><pre><code${cls}>${escapeHtml(code)}</code></pre></div>`;
};

renderer.table = (header, body) =>
  `<div class="tablewrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;

renderer.blockquote = (quote) => `<aside class="meta">${quote}</aside>`;

marked.setOptions({ renderer, gfm: true, headerIds: false, mangle: false });
let body = marked.parse(md);

// "临时实现" 统一变成醒目的标记
body = body
  .replace(/<strong>临时实现<\/strong>/g, '<span class="tag tag-temp">临时实现</span>')
  .replace(/【临时实现[^】]*】/g, (m) => `<span class="tag tag-temp">${m.slice(1, -1)}</span>`)
  .replace(/<strong>不做<\/strong>/g, '<span class="tag tag-no">不做</span>');

// ---------- 目录 ----------
const tocHtml = toc
  .map((h) => `<li class="toc-l${h.level}"><a href="#${h.id}">${h.text}</a></li>`)
  .join('\n');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 样式 ----------
const css = `
:root {
  --paper: #f5f7f9;
  --surface: #ffffff;
  --ink: #1b2430;
  --muted: #5d6874;
  --line: #d9dfe6;
  --accent: #1f5fbf;
  --accent-soft: #e4edfb;
  --temp: #9a5b00;
  --temp-soft: #fff1d6;
  --no: #8a2f2f;
  --no-soft: #fbe4e4;
  --code: #eef1f5;
  --shadow: 0 1px 2px rgba(20, 30, 40, .06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --paper: #0f141a; --surface: #161c24; --ink: #e6eaf0; --muted: #97a3b2; --line: #2a333f;
    --accent: #78b0ff; --accent-soft: #1a2a44; --temp: #f3c26b; --temp-soft: #3a2c10;
    --no: #f19a9a; --no-soft: #3d1f1f; --code: #1d2530; --shadow: none;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #0f141a; --surface: #161c24; --ink: #e6eaf0; --muted: #97a3b2; --line: #2a333f;
  --accent: #78b0ff; --accent-soft: #1a2a44; --temp: #f3c26b; --temp-soft: #3a2c10;
  --no: #f19a9a; --no-soft: #3d1f1f; --code: #1d2530; --shadow: none;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", Roboto, sans-serif;
  font-size: 16px; line-height: 1.75; -webkit-font-smoothing: antialiased;
}
.shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 40px; max-width: 1240px; margin: 0 auto; padding-block: 32px 96px; padding-inline: 20px; }
.toc { position: sticky; top: env(safe-area-inset-top, 0px); align-self: start; max-height: calc(100vh - 24px); overflow: auto; padding-right: 8px; }
.toc h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; font-family: inherit; }
.toc ul { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line); }
.toc li a { display: block; padding: 4px 12px; color: var(--muted); text-decoration: none; font-size: 13px; line-height: 1.45; border-left: 2px solid transparent; margin-left: -1px; }
.toc li a:hover, .toc li a:focus-visible { color: var(--accent); border-left-color: var(--accent); outline: none; }
.toc-l2 a { font-weight: 600; color: var(--ink); }
.toc-l3 a { padding-left: 24px; }
.toc details summary { cursor: pointer; font-weight: 600; }
.doc { min-width: 0; }
.doc h1 { font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; font-weight: 700; font-size: clamp(30px, 4.2vw, 42px); line-height: 1.2; letter-spacing: -.01em; margin: 0 0 12px; text-wrap: balance; }
.doc h2 { font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; font-weight: 700; font-size: 26px; line-height: 1.3; margin: 56px 0 16px; padding-top: 18px; border-top: 1px solid var(--line); text-wrap: balance; }
.doc h3 { font-size: 19px; font-weight: 700; margin: 36px 0 10px; text-wrap: balance; }
.doc h4 { font-size: 16px; font-weight: 700; margin: 24px 0 8px; color: var(--muted); }
.doc h2 .anchor, .doc h3 .anchor, .doc h4 .anchor { color: inherit; text-decoration: none; }
.doc h2 .anchor:hover::after, .doc h3 .anchor:hover::after { content: " #"; color: var(--accent); font-weight: 400; }
.doc p, .doc li { max-width: 72ch; }
.doc a { color: var(--accent); }
.doc hr { border: 0; height: 0; margin: 0; }
.doc strong { font-weight: 700; }
.doc ul, .doc ol { padding-left: 1.4em; }
.doc li + li { margin-top: 4px; }
.meta { margin: 0 0 28px; padding: 12px 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 14px; box-shadow: var(--shadow); }
.meta p { margin: 4px 0; max-width: none; }
.tablewrap { overflow-x: auto; margin: 16px 0 24px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); }
table { border-collapse: collapse; width: 100%; font-size: 14px; line-height: 1.55; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
th { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: color-mix(in srgb, var(--surface) 92%, var(--ink)); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td:first-child { font-weight: 600; white-space: nowrap; }
td, th { font-variant-numeric: tabular-nums; }
.codewrap { overflow-x: auto; margin: 14px 0 22px; border-radius: 8px; background: var(--code); border: 1px solid var(--line); }
pre { margin: 0; padding: 14px 16px; font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.6; }
code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; background: var(--code); padding: 1px 5px; border-radius: 4px; }
pre code { background: none; padding: 0; font-size: inherit; }
.diagram { overflow-x: auto; margin: 16px 0 24px; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
.diagram pre.mermaid { background: none; padding: 0; font-size: 13px; color: var(--muted); }
.diagram svg { max-width: 100%; height: auto; }
.tag { display: inline-block; font-size: 12px; font-weight: 600; line-height: 1.3; padding: 2px 8px; border-radius: 999px; vertical-align: 1px; white-space: nowrap; }
.tag-temp { color: var(--temp); background: var(--temp-soft); }
.tag-no { color: var(--no); background: var(--no-soft); }
.legend { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin: 0 0 24px; font-size: 13px; color: var(--muted); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); gap: 20px; padding-block: 20px 72px; padding-inline: 16px; }
  .toc { position: static; max-height: none; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
  .toc h2 { display: none; }
  .doc h2 { font-size: 22px; margin-top: 40px; }
}
`;

const headLinks = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@700&family=JetBrains+Mono:wght@400;600&display=swap">
`;

const legend = `
<div class="legend">
  <span>${versionLine}</span>
  <span><span class="tag tag-temp">临时实现</span> 待替换为 NocoBase 官方能力</span>
  <span><span class="tag tag-no">不做</span> 明确不在范围内</span>
</div>`;

const page = (withMermaidScript) => `<title>NocoProject 方案</title>
${headLinks}
<style>${css}</style>
<div class="shell">
  <nav class="toc" aria-label="目录">
    <h2>目录</h2>
    <details open>
      <summary>目录</summary>
      <ul>
${tocHtml}
      </ul>
    </details>
  </nav>
  <main class="doc">
${legend}
${body}
  </main>
</div>
${withMermaidScript ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.1/mermaid.min.js"></script>
<script>
(function () {
  if (!window.mermaid) return;
  var dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'loose' });
  var nodes = Array.prototype.filter.call(document.querySelectorAll('pre.mermaid'), function (n) { return !n.querySelector('svg'); });
  if (nodes.length) mermaid.run({ nodes: nodes });
})();
</script>` : ''}
`;

// 桌面上 summary 只在窄屏才有意义：宽屏隐藏 summary
const summaryFix = `<style>@media (min-width: 901px) { .toc details summary { display: none; } }</style>`;

const local = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${summaryFix}
</head>
<body>
${page(true)}
</body>
</html>`;

mkdirSync(dirname(artifactOut), { recursive: true });
writeFileSync(localOut, local);
writeFileSync(artifactOut, summaryFix + '\n' + page(true));

console.log(`已生成：\n  ${localOut}\n  ${artifactOut}\n版本：${versionLine}，目录条目 ${toc.length} 条。`);
