// 常見問題的截圖：用電腦上的 Chrome（無畫面模式）打開本機測試版（tools/dev-server.js --mock），
// 依下面的步驟操作後截圖，存到 img/help/*.png。截圖裡只有假名（測試甲、王小明⋯）。
// 執行：先開測試版（port 5175），再 node tools/help-shots.js [只拍某幾張的名字⋯]
//       node tools/help-shots.js --sheet a.svg b.svg ⋯   把幾張圖排成一張存到暫存資料夾（檢查示意圖用）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.SHOT_BASE || 'http://localhost:5175/';
const OUT = path.join(__dirname, '..', 'img', 'help');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  if (!CHROME) throw new Error('找不到 Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, '--no-first-run', '--hide-scrollbars', '--lang=zh-TW', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

function client(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { ok, fail } = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((ok, fail) => {
      id += 1;
      const my = id;
      const t = setTimeout(() => { waiting.delete(my); fail(new Error(method + ' 沒有回應')); }, 40000);
      waiting.set(my, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
      ws.send(JSON.stringify({ id: my, method, params }));
    });
    ws.onopen = () => resolve({ send, close: () => ws.close() });
  });
}

async function run(c, js) {
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true }),
    sleep(30000).then(() => { throw new Error('頁面裡的步驟超過 30 秒：' + js.slice(-120)); })
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
  return r.result.value;
}

async function shot(c, file, clipJs) {
  let clip;
  if (clipJs) {
    const r = await run(c, clipJs);
    if (r) clip = { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(50, Math.round(r.width)), height: Math.max(50, Math.round(r.height)), scale: 1 };
  }
  const res = await c.send('Page.captureScreenshot', Object.assign({ format: 'png', captureBeyondViewport: !!clip }, clip ? { clip } : {}));
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
}

// ---------- 截圖步驟 ----------
// 每一張：{ name, hash, js（打開後在頁面裡做的事）, clip（回傳要截的範圍 {x,y,width,height}，沒有就截整個畫面） }
const PREP = `
  const api = location.origin + '/api';
  window.__p = (b) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) }).then((r) => r.json());
  window.__g = (q) => fetch(api + '?' + new URLSearchParams(q)).then((r) => r.json());
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__box = (sel, pad = 8, extra = 0) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; el.scrollIntoView({ block: 'start' }); const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - pad) + scrollX, y: Math.max(0, r.top - pad) + scrollY, width: Math.min(innerWidth, r.width + pad * 2), height: r.height + pad * 2 + extra }; };
`;

const SEED = `
  if (window.__seeded) return;
  const ev = (await __g({ action: 'getEvents', from: '2026-10-07', to: '2026-11-30' })).data.duties.filter((d) => d.mode !== '公告型');
  const pick = ev.filter((d) => Object.keys(d.days).some((x) => x > '2026-10-07')).slice(0, 4);
  for (const d of pick) {
    const date = Object.keys(d.days).filter((x) => x > '2026-10-07')[0];
    await __p({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: [date], entries: [{ name: '測試甲', identity: '道親' }, { name: '王小明', identity: '壇辦' }] });
  }
  await __p({ action: 'requestVenue', dates: ['2026-10-17', '2026-10-24'], slots: ['晚上'], name: '測試甲', phone: '0900-000000', purpose: '讀書會', people: '15' });
  const tok = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token;
  await __p({ action: 'adminCreateDuties', token: tok, duties: [{ name: '研究班（示範）', category: '道務', nature: '課程', mode: '報名型', start: '2026-10-20', startTime: '19:30', location: '區中心', positions: [{ name: '參加', min: 0, max: null }] }] });
  const vr = (await __p({ action: 'adminVenue', token: tok })).data.requests.filter((r) => r.date === '2026-10-24');
  if (vr.length) await __p({ action: 'adminVenueDecide', token: tok, ids: vr.map((r) => r.id), decision: '已同意' });
  window.__seeded = true;
`;

const SHOTS = [
  { name: 'cal-day', hash: '#/', js: `document.querySelector('[data-view=month]').click(); await __wait(800);
`, tap: '.fc-daygrid-day[data-date="2026-10-10"]',
    clip: `const a = document.querySelector('#fc').getBoundingClientRect(); const b = document.querySelector('#day-panel').getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 8, width: innerWidth, height: Math.min(1500, b.bottom - a.top + 16) };` },
  { name: 'filter', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(600);`,
    clip: `return __box('#cat-filter', 10);` },
  { name: 'recent', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); document.querySelector('[data-cat="全部"]')?.click(); await __wait(600);`,
    clip: `const a = document.querySelector('#cat-filter'); a.scrollIntoView(); const r = a.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: 900 };` },
  { name: 'signup-form', hash: null, js: `const d = (await __g({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' })).data.duties.find((x) => x.name.includes('志工輪值'));
      location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=2026-10-13'; await __wait(2500);
      const inp = document.querySelector('#view-duty input[type=text], #view-duty input:not([type])'); inp.value = '測試乙'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const add = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.trim() === '加入'); add.click(); await __wait(400);
      const idb = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.trim() === '道親'); if (idb) idb.click(); await __wait(300);`,
    clip: `const h = [...document.querySelectorAll('#view-duty h2')].find((x) => x.textContent.includes('我要報名')); const r = h.getBoundingClientRect(); h.scrollIntoView(); const r2 = h.getBoundingClientRect(); const end = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.includes('確認報名')).getBoundingClientRect(); return { x: 0, y: r2.top + scrollY - 8, width: innerWidth, height: end.bottom - r2.top + 20 };` },
  { name: 'mine-list', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1000 };` },
  { name: 'mine-multi', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const c = document.querySelectorAll('[data-pick]'); c[0].checked = true; c[1].checked = true; await __wait(100);`,
    clip: `const t = document.querySelector('.mine-title'); t.scrollIntoView(); const r = t.getBoundingClientRect(); const b = document.querySelector('[data-cancel-picked]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: Math.min(1200, b.bottom - r.top + 16) };` },
  { name: 'resched', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const b = [...document.querySelectorAll('[data-reschedule]')].pop(); b.click(); await __wait(2000);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'push-panel', hash: '#/', js: `PushPage.openPanel(); await __wait(1200);`, clip: `return __box('.modal-box', 4);` },
  { name: 'venue-pick', hash: '#/venue', js: `await __wait(1500); const chip = [...document.querySelectorAll('#view-venue button, #view-venue label')].find((b) => /早上/.test(b.textContent)); if (chip) chip.click(); await __wait(300);`,
    clip: `const s = document.querySelector('#view-venue .venue-step, #view-venue section, #view-venue form'); return { x: 0, y: 0, width: innerWidth, height: 1100 };` },
  { name: 'venue-form', hash: '#/venue', js: `await __wait(1500); const f = document.querySelector('#view-venue form'); f.elements.name.value = '測試甲'; f.elements.phone.value = '0900-000000'; f.elements.purpose.value = '讀書會'; f.elements.people.value = '15'; f.elements.note.value = '要用投影機';`,
    clip: `const f = document.querySelector('#view-venue form'); const sec = f.closest('section') || f; return __box(f, 8);` },
  { name: 'venue-mine', hash: '#/venue', js: `await __wait(1500); const m = document.querySelector('[data-mine]'); m.elements.mname.value = '測試甲'; m.requestSubmit(); await __wait(1500);`,
    clip: `const m = document.querySelector('[data-mine]'); const sec = m.closest('section') || m.parentElement; return __box(sec, 8);` },
  { name: 'adm-recent', admin: true, hash: '#/admin', js: `await __wait(2000); const c = document.querySelectorAll('[data-invite-pick]'); c[0].checked = true; c[0].dispatchEvent(new Event('change')); c[1].checked = true; c[1].dispatchEvent(new Event('change')); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1300 };` },
  { name: 'adm-roster', admin: true, hash: '#/admin/day', js: `await __wait(2000); document.querySelector('[data-all]').click(); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1200 };` },
  { name: 'adm-push', admin: true, hash: '#/admin/push', js: `await __wait(2000); const sel = document.querySelector('select[name=duty]'); sel.selectedIndex = 5; sel.dispatchEvent(new Event('change')); await __wait(300); document.querySelector('[name=mode][value=later]').click(); await __wait(300); const q = document.querySelector('[data-quick]'); if (q) q.click(); await __wait(300);`,
    clip: `return __box('.push-form', 6);` },
  { name: 'adm-venue', admin: true, hash: '#/admin/venue', js: `await __wait(2000);`,
    clip: `const el = document.querySelector('.venue-reqs'); return __box(el.closest('[data-body]') || el, 4);` }
];

async function sheet(files) {
  const html = `<html><body style="margin:0;background:#bbb;display:flex;flex-wrap:wrap;gap:8px;padding:8px">${files.map((f) => `<div style="text-align:center;font:12px sans-serif"><img src="${BASE}img/help/${f}" style="height:520px;background:#fff"><br>${f}</div>`).join('')}</body></html>`;
  const tmp = path.join(os.tmpdir(), 'help-sheet.html');
  fs.writeFileSync(tmp, html);
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: Math.min(2400, files.length * 300 + 40), height: 600, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
    await sleep(1500);
    const out = path.join(os.tmpdir(), 'help-sheet.png');
    await shot(c, out);
    console.log(out);
  } finally { c.close(); proc.kill(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--sheet') return sheet(args.slice(1));
  const only = args;
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
    await c.send('Page.navigate', { url: BASE });
    await sleep(4500); // 開場動畫
    await run(c, PREP + `localStorage.setItem('duty-calendar:push-ask-later', String(Date.now())); localStorage.setItem('duty-calendar:cat', '全部');`);
    await run(c, PREP + SEED);
    await c.send('Page.reload');
    await sleep(4500);
    let adminDone = false;
    for (const s of SHOTS) {
      if (only.length && only.indexOf(s.name) === -1) continue;
      if (s.admin && !adminDone) {
        await run(c, PREP + `location.hash = '#/admin'; await __wait(1500); const pw = document.querySelector('input[type=password]'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`);
        adminDone = true;
      }
      await run(c, PREP + `for (let i = 0; i < 3; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
      await run(c, PREP + (s.hash ? `location.hash = '#/__'; await __wait(100); location.hash = ${JSON.stringify(s.hash)}; await __wait(1500); window.scrollTo(0, 0);` : '') + s.js);
      if (s.tap) {
        const p = await run(c, PREP + `const el = document.querySelector(${JSON.stringify(s.tap)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(900);
        await run(c, 'window.scrollTo(0, 0);');
      }
      await sleep(400);
      const file = path.join(OUT, s.name + '.png');
      await shot(c, file, PREP + s.clip);
      console.log('✓ ' + s.name);
    }
  } finally {
    c.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
