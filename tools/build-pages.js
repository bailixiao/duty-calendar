#!/usr/bin/env node
// 正式網站（2026/11/19 起）：https://jiaoquan-cal.pages.dev/（Cloudflare Pages，專案 jiaoquan-cal）。
// 把網站要用的檔案複製到 .pages-dist/（不放後端、Apps Script、測試、工具、文件），再上傳。
//   node tools/build-pages.js           只產生 .pages-dist/
//   node tools/build-pages.js --deploy  產生後上傳到 Cloudflare Pages
// 舊網址 bailixiao.github.io/duty-calendar/ 還在（GitHub Pages），打開會自動轉到新網址（index.html 最前面）。
// 注意：wrangler 新版的「pages」指令會改成建立 Worker，所以這裡固定用 wrangler@4.40.0。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.pages-dist');
const SKIP = new Set(['.git', '.gitignore', '.clasp.json', '.pages-dist', 'apps-script', 'worker', 'tests', 'tools', 'docs', 'node_modules', 'CLAUDE.md', 'README.md']);

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach((f) => copy(path.join(src, f), path.join(dst, f)));
  } else {
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);
let n = 0;
fs.readdirSync(ROOT).forEach((f) => {
  if (SKIP.has(f) || f.endsWith('.md')) return;
  copy(path.join(ROOT, f), path.join(OUT, f));
  n += 1;
});
console.log('已產生 .pages-dist/（' + n + ' 個項目）');

// 每個檔案自己的版本號（2026/11/24）：index.html 裡 js／css 的 ?v=日期 換成「檔案內容的雜湊」，
// 這次沒改到的檔案版本號不變，手機裡存的照樣用，不用每次更新都重新下載全部。
// 整個網站的版本（日期）留在 <meta name="app-version">，js/update-check.js 用它判斷有沒有新版。
{
  const crypto = require('crypto');
  const page = path.join(OUT, 'index.html');
  let html = fs.readFileSync(page, 'utf8');
  let hashed = 0;
  html = html.replace(/((?:src|href)=")((?:js|css)\/[\w./-]+\.(?:js|css))\?v=[\w-]+"/g, (m, pre, file) => {
    const p = path.join(OUT, file);
    if (!fs.existsSync(p)) throw new Error('index.html 寫的檔案不存在：' + file);
    hashed += 1;
    return `${pre}${file}?v=${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10)}"`;
  });
  if (!/<meta name="app-version" content="[\w-]+">/.test(html)) throw new Error('index.html 少了 <meta name="app-version">');
  fs.writeFileSync(page, html);
  console.log('檔案版本號換成內容雜湊：' + hashed + ' 個');
}

if (process.argv.includes('--deploy')) {
  execSync('npx -y wrangler@4.40.0 pages deploy .pages-dist --project-name jiaoquan-cal --branch main --commit-dirty=true', { cwd: ROOT, stdio: 'inherit' });
}
