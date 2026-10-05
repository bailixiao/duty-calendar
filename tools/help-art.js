// 產生「加到主畫面」教學的示意圖（img/help/home-*.svg）：簡化的手機畫面，紅圈標出要按的地方。
// 執行：node tools/help-art.js
// 這些是自己畫的示意圖（不是真的截圖），各品牌實際畫面會有一點不同；管理者可在後台換成實際截圖。
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'img', 'help');
fs.mkdirSync(OUT, { recursive: true });

const FONT = "font-family=\"'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif\"";
const RED = '#e0262b';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 16}" fill="${o.fill || '#222'}" ${o.bold ? 'font-weight="700"' : ''} text-anchor="${o.anchor || 'start'}">${esc(s)}</text>`;

/** 紅圈＋「點這裡」小標（可加步驟數字） */
function mark(x, y, r, o = {}) {
  const lx = o.lx !== undefined ? o.lx : x;
  const ly = o.ly !== undefined ? o.ly : y - r - 30;
  const label = o.label || '點這裡';
  const w = label.length * 17 + (o.n ? 34 : 18);
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${RED}" stroke-width="5"/>
    <line x1="${lx}" y1="${ly + 14}" x2="${x}" y2="${y - r}" stroke="${RED}" stroke-width="3"/>
    <rect x="${lx - w / 2}" y="${ly - 16}" width="${w}" height="30" rx="15" fill="${RED}"/>
    ${o.n ? `<circle cx="${lx - w / 2 + 16}" cy="${ly - 1}" r="11" fill="#fff"/>${text(lx - w / 2 + 16, ly + 5, o.n, { size: 15, fill: RED, bold: true, anchor: 'middle' })}` : ''}
    ${text(lx + (o.n ? 9 : 0), ly + 5, label, { size: 16, fill: '#fff', bold: true, anchor: 'middle' })}`;
}

/** 手機外框（直式 360×640） */
function phone(inner, o = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640" width="360" height="640" ${FONT}>
  <rect x="2" y="2" width="356" height="636" rx="44" fill="#1d1d1f"/>
  <rect x="12" y="12" width="336" height="616" rx="36" fill="${o.bg || '#ffffff'}"/>
  <clipPath id="scr"><rect x="12" y="12" width="336" height="616" rx="36"/></clipPath>
  <g clip-path="url(#scr)">
    ${o.android ? text(30, 38, '09:41', { size: 14, bold: true }) + text(330, 38, '▼ ▮', { size: 13, anchor: 'end' }) : text(46, 40, '9:41', { size: 15, bold: true }) + `<rect x="128" y="20" width="104" height="28" rx="14" fill="#1d1d1f"/>` + text(318, 40, '▮▮ ◔', { size: 13, anchor: 'end' })}
    ${inner}
  </g>
</svg>`;
}

/** 網站內容（簡化的行事曆頁） */
function site(top, h) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const y = top + 70 + i * 62;
    if (y + 50 > top + h) break;
    rows.push(`<rect x="28" y="${y}" width="304" height="50" rx="10" fill="#fffcf6" stroke="#ddd4c3"/><rect x="40" y="${y + 12}" width="${120 + (i % 2) * 40}" height="10" rx="5" fill="#57514a"/><rect x="40" y="${y + 30}" width="90" height="8" rx="4" fill="#bdb4a5"/><rect x="262" y="${y + 16}" width="56" height="20" rx="10" fill="#f4e2da"/>`);
  }
  return `<rect x="12" y="${top}" width="336" height="${h}" fill="#f6f1e7"/>
    ${text(28, top + 38, '教全區行事曆', { size: 20, bold: true, fill: '#2a2724' })}
    <rect x="28" y="${top + 50}" width="304" height="1" fill="#ddd4c3"/>
    ${rows.join('')}`;
}

// ---------- 圖示 ----------
const shareIcon = (x, y, c = '#0a7aff', s = 1) => `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M-8 -2 h-3 v15 h22 v-15 h-3"/><path d="M0 -13 v17"/><path d="M-5 -8 l5 -5 l5 5"/></g>`;
const bookIcon = (x, y, c = '#0a7aff') => `<g transform="translate(${x},${y})" fill="none" stroke="${c}" stroke-width="2.2"><path d="M-11 -9 q5 -2 11 1 q6 -3 11 -1 v17 q-5 -2 -11 1 q-6 -3 -11 -1 z"/><path d="M0 -8 v17"/></g>`;
const tabsIcon = (x, y, c = '#0a7aff') => `<g transform="translate(${x},${y})" fill="none" stroke="${c}" stroke-width="2.2"><rect x="-8" y="-6" width="15" height="15" rx="3"/><path d="M-4 -10 h11 a3 3 0 0 1 3 3 v11"/></g>`;
const chevron = (x, y, dir, c = '#0a7aff') => `<path d="M${x + (dir < 0 ? 4 : -4)} ${y - 9} l${dir < 0 ? -8 : 8} 9 l${dir < 0 ? 8 : -8} 9" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
const dotsH = (x, y, c = '#222') => [-8, 0, 8].map((d) => `<circle cx="${x + d}" cy="${y}" r="2.6" fill="${c}"/>`).join('');
const dotsV = (x, y, c = '#222') => [-8, 0, 8].map((d) => `<circle cx="${x}" cy="${y + d}" r="2.6" fill="${c}"/>`).join('');
const burger = (x, y, c = '#222') => [-7, 0, 7].map((d) => `<rect x="${x - 10}" y="${y + d - 1.3}" width="20" height="2.6" rx="1.3" fill="${c}"/>`).join('');
const plusSquare = (x, y, c = '#222') => `<g transform="translate(${x},${y})" fill="none" stroke="${c}" stroke-width="2.2"><rect x="-10" y="-10" width="20" height="20" rx="5"/><path d="M0 -5 v10 M-5 0 h10"/></g>`;
const appIcon = (x, y, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-26" y="-26" width="52" height="52" rx="12" fill="#9e3d22"/><text x="0" y="8" font-size="22" fill="#fff" font-weight="700" text-anchor="middle">行</text></g>`;

// Safari 下方的網址列＋工具列
function safariBottom(highlight) {
  return `<rect x="12" y="520" width="336" height="108" fill="#f2f2f7"/>
    <rect x="24" y="530" width="312" height="40" rx="12" fill="#ffffff" stroke="#d1d1d6"/>
    ${text(180, 556, '🔒 bailixiao.github.io', { size: 15, anchor: 'middle', fill: '#333' })}
    ${chevron(46, 598, -1)}${chevron(108, 598, 1, '#b8b8bd')}${shareIcon(180, 598)}${bookIcon(250, 598)}${tabsIcon(314, 598)}
    ${highlight ? mark(180, 596, 24, { label: '分享', ly: 486 }) : ''}`;
}

const files = {};

// 怎麼分辨（瀏覽器圖示）
files['home-which.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 330" width="360" height="330" ${FONT}>
  <rect width="360" height="330" rx="18" fill="#fffcf6" stroke="#ddd4c3"/>
  ${text(180, 34, '看看您是用哪一個打開的', { size: 18, bold: true, anchor: 'middle' })}
  <g transform="translate(70,100)"><circle r="34" fill="#1c8cff"/><circle r="27" fill="#fff"/><path d="M0 -22 L7 0 L0 22 L-7 0 Z" fill="#e0262b" transform="rotate(45)"/><path d="M0 0 L7 0 L0 22 L-7 0 Z" fill="#c9c9c9" transform="rotate(45)"/></g>
  ${text(70, 156, 'Safari', { size: 16, bold: true, anchor: 'middle' })}${text(70, 176, 'iPhone、iPad', { size: 13, anchor: 'middle', fill: '#57514a' })}
  <g transform="translate(180,100)"><circle r="34" fill="#db4437"/><path d="M0 0 L-29.4 17 A34 34 0 0 1 0 -34 Z" fill="#db4437"/><path d="M0 0 L0 -34 A34 34 0 0 1 29.4 17 Z" fill="#f4b400"/><path d="M0 0 L29.4 17 A34 34 0 0 1 -29.4 17 Z" fill="#0f9d58"/><circle r="15" fill="#fff"/><circle r="11" fill="#4285f4"/></g>
  ${text(180, 156, 'Chrome', { size: 16, bold: true, anchor: 'middle' })}${text(180, 176, '大部分 Android', { size: 13, anchor: 'middle', fill: '#57514a' })}
  <g transform="translate(290,100)"><circle r="34" fill="#7b4cf5"/><ellipse rx="40" ry="12" fill="none" stroke="#fff" stroke-width="5" transform="rotate(-25)"/><circle r="16" fill="#fff"/><circle r="11" fill="#7b4cf5"/></g>
  ${text(290, 156, 'Samsung', { size: 16, bold: true, anchor: 'middle' })}${text(290, 176, '網際網路（三星）', { size: 13, anchor: 'middle', fill: '#57514a' })}
  <g transform="translate(125,248)"><rect x="-32" y="-32" width="64" height="64" rx="16" fill="#06c755"/><path d="M-18 -4 q0 -14 18 -14 q18 0 18 14 q0 14 -18 14 q-4 0 -8 -1 l-8 5 l2 -7 q-4 -4 -4 -11 z" fill="#fff"/></g>
  ${text(125, 300, 'LINE 裡面', { size: 16, bold: true, anchor: 'middle' })}${text(125, 318, '要先改用瀏覽器', { size: 13, anchor: 'middle', fill: '#e0262b' })}
  <g transform="translate(240,248)"><rect x="-26" y="-34" width="52" height="68" rx="8" fill="#2a2724"/><rect x="-21" y="-27" width="42" height="50" rx="3" fill="#f6f1e7"/><circle cy="28" r="3" fill="#888"/></g>
  ${text(240, 300, '不確定？', { size: 16, bold: true, anchor: 'middle' })}${text(240, 318, '看手機背面的牌子', { size: 13, anchor: 'middle', fill: '#57514a' })}
</svg>`;

// iPhone Safari（網址列在下面）
files['home-ios-1.svg'] = phone(`${site(56, 464)}${safariBottom(true)}`);

// iPhone Safari（網址列在上面）
files['home-ios-1b.svg'] = phone(`
  <rect x="12" y="52" width="336" height="56" fill="#f2f2f7"/>
  <rect x="24" y="60" width="312" height="38" rx="11" fill="#fff" stroke="#d1d1d6"/>
  ${text(180, 85, '🔒 bailixiao.github.io', { size: 15, anchor: 'middle', fill: '#333' })}
  ${site(108, 452)}
  <rect x="12" y="560" width="336" height="68" fill="#f2f2f7"/>
  ${chevron(46, 590, -1)}${chevron(108, 590, 1, '#b8b8bd')}${shareIcon(180, 590)}${bookIcon(250, 590)}${tabsIcon(314, 590)}
  ${mark(180, 588, 24, { label: '分享在下面這排中間', ly: 520 })}`);

// 分享選單
const sheetRows = ['拷貝', '加入閱讀列表', '加入書籤', '加入喜好項目', '在頁面中尋找', '加入主畫面', '標示', '列印'];
files['home-ios-2.svg'] = phone(`
  <rect x="12" y="12" width="336" height="616" fill="#8e8e93" opacity=".55"/>
  <rect x="12" y="96" width="336" height="540" rx="18" fill="#f2f2f7"/>
  ${appIcon(52, 140, 0.7)}${text(80, 136, '教全區行事曆', { size: 15, bold: true })}${text(80, 156, 'bailixiao.github.io　選項 ›', { size: 12, fill: '#8e8e93' })}
  <circle cx="318" cy="134" r="13" fill="#e3e3e8"/>${text(318, 139, '✕', { size: 13, anchor: 'middle', fill: '#666' })}
  ${['AirDrop', '訊息', 'LINE', '郵件'].map((n, i) => `<circle cx="${60 + i * 80}" cy="206" r="26" fill="${['#1c8cff', '#34c759', '#06c755', '#1c8cff'][i]}"/>${text(60 + i * 80, 250, n, { size: 12, anchor: 'middle' })}`).join('')}
  <rect x="24" y="270" width="312" height="${sheetRows.length * 40}" rx="12" fill="#fff"/>
  ${sheetRows.map((n, i) => `${i ? `<rect x="40" y="${270 + i * 40}" width="296" height="1" fill="#e5e5ea"/>` : ''}${text(42, 296 + i * 40, n, { size: 15, bold: n === '加入主畫面' })}${n === '加入主畫面' ? plusSquare(312, 290 + i * 40) : `<rect x="304" y="${282 + i * 40}" width="16" height="16" rx="3" fill="none" stroke="#999" stroke-width="1.6"/>`}`).join('')}
  ${text(180, 270 + sheetRows.length * 40 + 30, '編輯動作⋯', { size: 15, fill: '#0a7aff', anchor: 'middle' })}
  <rect x="26" y="${272 + 5 * 40}" width="308" height="36" rx="8" fill="none" stroke="${RED}" stroke-width="4"/>
  ${mark(250, 272 + 5 * 40, 0.01, { label: '往上滑找到這個', lx: 250, ly: 290 + 4 * 40 - 4 })}`, { bg: '#ffffff' });

// 加入主畫面確認頁
files['home-ios-3.svg'] = phone(`
  <rect x="12" y="52" width="336" height="576" fill="#f2f2f7"/>
  ${text(34, 92, '取消', { size: 16, fill: '#0a7aff' })}${text(180, 92, '加入主畫面', { size: 16, bold: true, anchor: 'middle' })}${text(326, 92, '加入', { size: 16, fill: '#0a7aff', bold: true, anchor: 'end' })}
  <rect x="24" y="118" width="312" height="96" rx="12" fill="#fff"/>
  ${appIcon(72, 166, 0.95)}${text(112, 160, '教全區行事曆', { size: 16 })}<rect x="112" y="168" width="208" height="1" fill="#e5e5ea"/>${text(112, 192, 'bailixiao.github.io/duty-calendar', { size: 12, fill: '#8e8e93' })}
  <rect x="24" y="232" width="312" height="46" rx="12" fill="#fff"/>${text(40, 261, '以網頁 App 打開', { size: 15 })}<rect x="278" y="244" width="46" height="24" rx="12" fill="#34c759"/><circle cx="312" cy="256" r="10" fill="#fff"/>
  ${text(180, 300, '（有這一行的話，保持打開）', { size: 12, fill: '#8e8e93', anchor: 'middle' })}
  ${mark(305, 86, 28, { label: '點「加入」', lx: 284, ly: 150 })}`);

// 主畫面多了圖示
const homeApps = ['#34c759', '#ff9500', '#5856d6', '#ff2d55', '#1c8cff', '#ffcc00', '#8e8e93', '#30b0c7', '#af52de', '#ff3b30', '#06c755'];
files['home-ios-4.svg'] = phone(`
  <rect x="12" y="12" width="336" height="616" fill="#6d8fb8"/>
  ${homeApps.map((c, i) => `<rect x="${36 + (i % 4) * 76}" y="${78 + Math.floor(i / 4) * 92}" width="56" height="56" rx="13" fill="${c}"/>`).join('')}
  ${appIcon(36 + 3 * 76 + 28, 78 + 2 * 92 + 28, 1.08)}
  ${text(36 + 3 * 76 + 28, 78 + 2 * 92 + 76, '教全區行事曆', { size: 11, fill: '#fff', anchor: 'middle', bold: true })}
  ${mark(36 + 3 * 76 + 28, 78 + 2 * 92 + 28, 40, { label: '以後點這個打開', lx: 180, ly: 430 })}`, { bg: '#6d8fb8' });

// iOS 26：下面只有網址和「⋯」
files['home-ios26-1.svg'] = phone(`${site(56, 500)}
  <rect x="12" y="556" width="336" height="72" fill="#f6f1e7"/>
  <circle cx="44" cy="584" r="20" fill="#ffffff" stroke="#d1d1d6"/>${chevron(44, 584, -1, '#333')}
  <rect x="72" y="564" width="216" height="40" rx="20" fill="#ffffff" stroke="#d1d1d6"/>${text(180, 590, 'bailixiao.github.io', { size: 14, anchor: 'middle', fill: '#333' })}
  <circle cx="316" cy="584" r="20" fill="#ffffff" stroke="#d1d1d6"/>${dotsH(316, 584, '#333')}
  ${mark(316, 584, 26, { label: '點右下角「⋯」', lx: 250, ly: 510 })}`);
files['home-ios26-2.svg'] = phone(`${site(56, 500)}
  <rect x="12" y="12" width="336" height="616" fill="#000" opacity=".25"/>
  <rect x="120" y="330" width="214" height="226" rx="22" fill="#fbfbfd"/>
  ${['分享', '加入書籤', '加入喜好項目', '加入閱讀列表', '在頁面中尋找'].map((n, i) => `${text(144, 368 + i * 42, n, { size: 15, bold: n === '分享' })}${i ? `<rect x="136" y="${342 + i * 42}" width="182" height="1" fill="#e5e5ea"/>` : ''}`).join('')}
  ${shareIcon(304, 362, '#333', 0.8)}
  <rect x="128" y="340" width="198" height="40" rx="10" fill="none" stroke="${RED}" stroke-width="4"/>
  ${mark(226, 360, 0.01, { label: '點「分享」', lx: 200, ly: 300 })}
  <circle cx="316" cy="584" r="20" fill="#ffffff" stroke="#d1d1d6"/>${dotsH(316, 584, '#333')}`);

// iPad（橫的）
files['home-ipad-1.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" width="640" height="440" ${FONT}>
  <rect x="2" y="2" width="636" height="436" rx="30" fill="#1d1d1f"/>
  <rect x="16" y="16" width="608" height="408" rx="18" fill="#f6f1e7"/>
  <rect x="16" y="16" width="608" height="54" rx="18" fill="#f2f2f7"/><rect x="16" y="50" width="608" height="20" fill="#f2f2f7"/>
  ${chevron(44, 44, -1)}${chevron(78, 44, 1, '#b8b8bd')}
  <rect x="190" y="26" width="260" height="34" rx="10" fill="#fff" stroke="#d1d1d6"/>${text(320, 49, '🔒 bailixiao.github.io', { size: 14, anchor: 'middle', fill: '#333' })}
  ${shareIcon(520, 44)}<path d="M556 36 v16 M548 44 h16" stroke="#0a7aff" stroke-width="2.4"/>${tabsIcon(598, 44)}
  ${text(40, 110, '教全區行事曆', { size: 22, bold: true, fill: '#2a2724' })}
  ${[0, 1, 2].map((i) => `<rect x="40" y="${130 + i * 70}" width="560" height="56" rx="10" fill="#fffcf6" stroke="#ddd4c3"/>`).join('')}
  ${mark(520, 42, 24, { label: '點右上角的「分享」', lx: 440, ly: 120 })}
</svg>`;

// iPhone Chrome
files['home-ios-chrome-1.svg'] = phone(`
  <rect x="12" y="52" width="336" height="56" fill="#f1f3f4"/>
  <rect x="22" y="60" width="316" height="40" rx="20" fill="#fff" stroke="#dadce0"/>
  ${text(40, 85, 'bailixiao.github.io', { size: 14, fill: '#333' })}${shareIcon(312, 80, '#5f6368', 0.85)}
  ${site(108, 452)}
  <rect x="12" y="560" width="336" height="68" fill="#f1f3f4"/>
  ${chevron(44, 590, -1, '#5f6368')}${chevron(104, 590, 1, '#bbb')}<path d="M172 590 h16 M180 582 v16" stroke="#5f6368" stroke-width="2.4"/>${tabsIcon(250, 590, '#5f6368')}${dotsH(312, 590, '#5f6368')}
  ${mark(312, 80, 22, { label: '點網址旁的「分享」', lx: 252, ly: 150 })}
  ${mark(312, 590, 22, { label: '沒有的話點「⋯」', lx: 220, ly: 520, n: '或' })}`);

// Android Chrome
files['home-android-1.svg'] = phone(`
  <rect x="12" y="52" width="336" height="56" fill="#ffffff"/>
  <path d="M30 80 l9 -8 l9 8 v9 h-18 z" fill="none" stroke="#5f6368" stroke-width="2"/>
  <rect x="62" y="62" width="214" height="36" rx="18" fill="#f1f3f4"/>${text(80, 85, 'bailixiao.github.io', { size: 14, fill: '#333' })}
  <rect x="288" y="70" width="20" height="20" rx="4" fill="none" stroke="#5f6368" stroke-width="2"/>${text(298, 85, '3', { size: 12, anchor: 'middle', fill: '#5f6368', bold: true })}
  ${dotsV(328, 80, '#5f6368')}
  ${site(108, 520)}
  ${mark(328, 80, 20, { label: '點右上角「⋮」', lx: 250, ly: 150 })}`, { android: true });
const menu = ['新分頁', '新增無痕分頁', '歷史記錄', '下載內容', '書籤', '分享⋯', '在網頁中尋找', '加到主畫面', '', '電腦版網站', '設定'];
files['home-android-2.svg'] = phone(`${site(52, 576)}
  <rect x="150" y="56" width="190" height="${menu.length * 44 + 56}" rx="8" fill="#fff" stroke="#e0e0e0"/>
  ${text(245, 88, '→　☆　⬇　ⓘ　↻', { size: 14, fill: '#5f6368', anchor: 'middle' })}
  ${menu.map((n, i) => text(170, 140 + i * 44, n, { size: 15, bold: n === '加到主畫面' })).join('')}
  ${text(170, 140 + 7 * 44 + 21, '有的寫「安裝應用程式」', { size: 12, fill: RED, bold: true })}
  <rect x="156" y="${114 + 7 * 44}" width="178" height="54" rx="6" fill="none" stroke="${RED}" stroke-width="4"/>
  ${mark(156, 132 + 7 * 44, 0.01, { label: '點這個', lx: 84, ly: 132 + 7 * 44 - 60 })}`, { android: true });
files['home-android-3.svg'] = phone(`${site(52, 576)}
  <rect x="12" y="12" width="336" height="616" fill="#000" opacity=".35"/>
  <rect x="36" y="220" width="288" height="210" rx="22" fill="#fff"/>
  ${text(60, 262, '安裝應用程式', { size: 19, bold: true })}
  ${appIcon(84, 316, 0.8)}${text(120, 312, '教全區行事曆', { size: 16 })}${text(120, 334, 'bailixiao.github.io', { size: 12, fill: '#777' })}
  ${text(206, 400, '取消', { size: 16, fill: '#1a73e8', anchor: 'middle' })}${text(286, 400, '安裝', { size: 16, fill: '#1a73e8', bold: true, anchor: 'middle' })}
  ${text(180, 456, '有的手機寫「新增」，意思一樣', { size: 13, fill: '#fff', anchor: 'middle', bold: true })}
  ${mark(286, 394, 26, { label: '點「安裝」或「新增」', lx: 200, ly: 180 })}`, { android: true });

// Samsung 網際網路
files['home-samsung-1.svg'] = phone(`
  <rect x="12" y="52" width="336" height="54" fill="#fff"/>
  <rect x="24" y="60" width="312" height="38" rx="19" fill="#f2f2f2"/>${text(44, 84, '🔒 bailixiao.github.io', { size: 14, fill: '#333' })}
  ${site(106, 456)}
  <rect x="12" y="562" width="336" height="66" fill="#fff"/>
  ${chevron(40, 594, -1, '#333')}${chevron(96, 594, 1, '#bbb')}
  <path d="M146 598 l12 -11 l12 11 v10 h-24 z" fill="none" stroke="#333" stroke-width="2"/>
  <path d="M202 586 v18 l7 -5 l7 5 v-18 z" fill="none" stroke="#333" stroke-width="2"/>${tabsIcon(264, 595, '#333')}${burger(318, 595, '#333')}
  ${mark(318, 595, 22, { label: '點右下角「≡」', lx: 240, ly: 520 })}`, { android: true });
files['home-samsung-2.svg'] = phone(`${site(52, 576)}
  <rect x="12" y="12" width="336" height="616" fill="#000" opacity=".3"/>
  <rect x="12" y="330" width="336" height="298" rx="24" fill="#fff"/>
  ${['書籤', '已存網頁', '歷史記錄', '下載', '新增頁面至', '設定', '分享', '尋找'].map((n, i) => `<rect x="${30 + (i % 4) * 78}" y="${356 + Math.floor(i / 4) * 92}" width="44" height="44" rx="14" fill="${n === '新增頁面至' ? '#7b4cf5' : '#eeeeee'}"/>${text(52 + (i % 4) * 78, 420 + Math.floor(i / 4) * 92, n, { size: 11, anchor: 'middle', bold: n === '新增頁面至' })}`).join('')}
  ${mark(52, 470, 30, { label: '①「新增頁面至」', lx: 120, ly: 312 })}
  <rect x="150" y="150" width="180" height="140" rx="16" fill="#fff" stroke="#ddd"/>
  ${['書籤', '快速存取', '主畫面'].map((n, i) => text(172, 186 + i * 42, n, { size: 15, bold: n === '主畫面' })).join('')}
  <rect x="158" y="246" width="164" height="36" rx="8" fill="none" stroke="${RED}" stroke-width="4"/>
  ${mark(158, 264, 0.01, { label: '②「主畫面」', lx: 80, ly: 120 })}`, { android: true });

// LINE 裡面
files['home-line-1.svg'] = phone(`
  <rect x="12" y="52" width="336" height="56" fill="#ffffff"/>
  ${text(34, 88, '✕', { size: 20, fill: '#333' })}${text(170, 78, '教全區行事曆', { size: 15, bold: true, anchor: 'middle' })}${text(170, 98, 'bailixiao.github.io', { size: 11, fill: '#888', anchor: 'middle' })}
  ${shareIcon(282, 82, '#333', 0.8)}${dotsV(324, 82, '#333')}
  ${site(108, 520)}
  ${mark(324, 82, 20, { label: '點右上角「⋮」或「⋯」', lx: 240, ly: 156 })}`);
const lineMenu = ['用預設瀏覽器開啟', '重新整理', '分享', '複製連結'];
files['home-line-2.svg'] = phone(`${site(52, 576)}
  <rect x="12" y="12" width="336" height="616" fill="#000" opacity=".35"/>
  <rect x="12" y="410" width="336" height="218" rx="22" fill="#fff"/>
  ${lineMenu.map((n, i) => `${text(40, 452 + i * 46, n, { size: 16, bold: i === 0 })}${i ? `<rect x="30" y="${428 + i * 46}" width="300" height="1" fill="#eee"/>` : ''}`).join('')}
  <rect x="26" y="430" width="308" height="40" rx="8" fill="none" stroke="${RED}" stroke-width="4"/>
  ${text(180, 330, 'iPhone 可能寫「以 Safari 開啟」', { size: 14, fill: '#fff', anchor: 'middle', bold: true })}
  ${mark(180, 430, 0.01, { label: '點「用預設瀏覽器開啟」', lx: 180, ly: 380 })}`);

Object.entries(files).forEach(([name, svg]) => fs.writeFileSync(path.join(OUT, name), svg.replace(/\n\s+/g, '\n')));
console.log('寫入 ' + Object.keys(files).length + ' 張示意圖到 img/help/');
