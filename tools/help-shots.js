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
const PORT = Number(process.env.SHOT_CDP_PORT) || 9334; // 書槑子那份工具用 9333，同時拍截圖才不會互搶
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
  await __p({ action: 'requestVenue', dates: ['2026-11-07', '2026-11-14'], slots: ['18:00', '19:00', '20:00'], name: '測試甲', phone: '0900-000000', purpose: '讀書會', people: '15' });
  const tok = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token;
  await __p({ action: 'adminCreateDuties', token: tok, duties: [{ name: '研究班（示範）', category: '道務', nature: '課程', mode: '報名型', start: '2026-11-03', startTime: '19:30', location: '區中心', positions: [{ name: '參加', min: 0, max: null }] }] });
  const vr = (await __p({ action: 'adminVenue', token: tok })).data.requests.filter((r) => r.date === '2026-11-14');
  if (vr.length) await __p({ action: 'adminVenueDecide', token: tok, ids: vr.map((r) => r.id), decision: '已同意' });
  window.__seeded = true;
`;

// 感謝排行榜、了愿感謝狀、說明加圖片、場地只取消某幾天（2026/11/19）要的資料：過去的出勤用補登加（假名）
const SEED2 = `
  if (window.__seeded2) return;
  const tok = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const res = (await __g({ action: 'getEvents', from: '2026-08-01', to: '2027-01-31' })).data;
  const today = res.today;
  const find = (name, start) => res.duties.find((d) => d.name === name && (!start || d.start === start));
  const add = async (d, pi, date, name, identity) => { if (d && date < today) await __p({ action: 'adminAddAttendee', token: tok, dutyId: d.id, positionId: d.positions[pi].id, date, name, identity: identity || '道親' }); };
  // 12人小組：好幾天、好幾個職司（感謝狀用）
  const team = find('12人小組輪值');
  if (team) {
    const days = Object.keys(team.days).sort().filter((x) => x < today);
    for (const x of days.slice(0, 6)) await add(team, 0, x, '測試甲');
    for (const x of days.slice(0, 4)) await add(team, 0, x, '測試乙');
    for (const x of days.slice(2, 7)) await add(team, 1, x, '測試丙');
    for (const x of days.slice(0, 3)) await add(team, 2, x, '王小明', '壇辦');
    for (const x of days.slice(3, 5)) await add(team, 3, x, '測試丁');
    for (const x of days.slice(5, 7)) await add(team, 3, x, '測試戊');
  }
  // 其他勤務（排行榜用）
  const vol = res.duties.filter((d) => d.name === '彌勒山志工輪值' && d.start < today);
  for (const [i, d] of vol.entries()) { await add(d, 0, d.start, i % 2 ? '測試乙' : '測試丁'); if (i < 2) await add(d, 0, d.start, '測試己'); }
  const clean = res.duties.filter((d) => /打掃|大掃除/.test(d.name) && d.start < today);
  for (const [i, d] of clean.entries()) { await add(d, 0, d.start, ['測試甲', '測試丙', '王小明', '測試庚'][i % 4], i % 4 === 2 ? '壇辦' : '道親'); }
  // 場地：之後借好幾天、已同意（只取消某幾天用）
  const fut = [7, 14, 21].map((n) => { const t = new Date(today + 'T12:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); });
  await __p({ action: 'requestVenue', dates: fut, slots: ['19:00', '20:00'], name: '測試乙', phone: '0900-000000', purpose: '讀書會', people: '12' });
  const vr = (await __p({ action: 'adminVenue', token: tok })).data.requests.filter((r) => fut.includes(r.date) && r.status !== '已同意');
  if (vr.length) await __p({ action: 'adminVenueDecide', token: tok, ids: vr.map((r) => r.id), decision: '已同意' });
  // 說明裡的圖片：畫一張示意圖上傳，放進宏宗大掃除的說明
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 450; const g = cv.getContext('2d');
  g.fillStyle = '#f6f1e7'; g.fillRect(0, 0, 800, 450);
  g.fillStyle = '#d9cbb3'; g.fillRect(60, 250, 680, 140); g.fillStyle = '#555'; g.fillRect(140, 210, 160, 40); g.fillRect(500, 210, 160, 40);
  g.fillStyle = '#333'; g.font = 'bold 34px sans-serif'; g.fillText('廚房：瓦斯開關位置', 60, 70);
  g.font = '26px sans-serif'; g.fillText('瓦斯爐', 175, 300); g.fillText('瓦斯爐', 535, 300);
  g.fillStyle = '#c0392b'; g.fillRect(385, 330, 30, 30); g.strokeStyle = '#c0392b'; g.lineWidth = 6; g.beginPath(); g.arc(400, 345, 42, 0, 7); g.stroke();
  g.font = 'bold 26px sans-serif'; g.fillText('總開關（用完關掉）', 290, 140); g.beginPath(); g.moveTo(400, 155); g.lineTo(400, 295); g.stroke();
  const up = await __p({ action: 'adminUploadFile', token: tok, mime: 'image/jpeg', name: 'gas.jpg', data: cv.toDataURL('image/jpeg', 0.9).split(',')[1] });
  const big = find('宏宗大掃除');
  if (big && up.ok) {
    const edit = (await __p({ action: 'adminDutyForEdit', token: tok, id: big.id })).data.duty;
    await __p({ action: 'adminUpdateDuty', token: tok, id: big.id, duty: Object.assign({}, edit, { description: '大殿、廚房、廁所分區打掃，抹布、清潔劑在儲藏室。\\n離開前請確認瓦斯關好：\\n![廚房瓦斯開關位置](' + up.data.id + ')\\n垃圾分類後帶到一樓。' }) });
  }
  window.__seeded2 = true;
`;

const SHOTS = [
  { name: 'cal-day', hash: '#/', js: `document.querySelector('[data-view=month]').click(); await __wait(800);
`, tap: '.fc-daygrid-day[data-date="2026-10-10"]',
    clip: `const a = document.querySelector('#fc').getBoundingClientRect(); const b = document.querySelector('#day-panel').getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 8, width: innerWidth, height: Math.min(1500, b.bottom - a.top + 16) };` },
  { name: 'filter', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(600);`,
    clip: `return __box('#cat-filter', 10);` },
  { name: 'recent', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); document.querySelector('[data-cat="全部"]')?.click(); await __wait(600);`,
    clip: `const a = document.querySelector('#cat-filter'); a.scrollIntoView(); const r = a.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: 900 };` },
  { name: 'signup-form', hash: null, js: `const res = (await __g({ action: 'getEvents', from: '2026-10-13', to: '2026-11-30' })).data; const d = res.duties.find((x) => x.name.includes('志工輪值') && x.start > res.today); // 當天不能報名，挑之後的
      location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(2500);
      const inp = document.querySelector('#view-duty input[type=text], #view-duty input:not([type])'); inp.value = '測試乙'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const add = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.trim() === '加入'); add.click(); await __wait(400);
      const idb = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.trim() === '道親'); if (idb) idb.click(); await __wait(300);`,
    clip: `const h = [...document.querySelectorAll('#view-duty h2')].find((x) => x.textContent.includes('我要報名')); const r = h.getBoundingClientRect(); h.scrollIntoView(); const r2 = h.getBoundingClientRect(); const end = [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.includes('確認報名')).getBoundingClientRect(); return { x: 0, y: r2.top + scrollY - 8, width: innerWidth, height: end.bottom - r2.top + 20 };` },
  { name: 'signup-temple', hash: null, js: `const tok = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token;
      for (const [n, t, i] of [['測試戊', '測試佛堂A', '道親'], ['測試己', '測試佛堂A', '壇辦'], ['測試庚', '測試佛堂A', '道親'], ['測試辛', '測試佛堂B', '道親']]) await __p({ action: 'adminSaveMember', token: tok, member: { name: n, identity: i, temple: t } });
      const res = (await __g({ action: 'getEvents', from: '2026-10-13', to: '2026-11-30' })).data; const d = res.duties.find((x) => x.name.includes('志工輪值') && x.start > res.today);
      const edit = (await __p({ action: 'adminDutyForEdit', token: tok, id: d.id })).data.duty;
      await __p({ action: 'adminUpdateDuty', token: tok, id: d.id, duty: Object.assign({}, edit, { templePick: true }) });
      localStorage.setItem('duty-calendar:signup-temple', '測試佛堂A');
      location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(3000);
      for (let i = 0; i < 30 && !document.querySelector('[data-temple-member="測試戊"]'); i++) await __wait(300);
      document.querySelector('[data-temple-member="測試戊"]').click(); await __wait(400);`,
    clip: `const h = [...document.querySelectorAll('#view-duty legend')].find((x) => x.textContent.includes('填名字')); const f = h.closest('fieldset'); return __box(f, 8);` },
  { name: 'signup-done', hash: '#/', js: `await __wait(800); localStorage.setItem('duty-calendar:celebrate-turn', '2'); Celebrate.show(['測試甲', '測試乙']); await __wait(1200);` }, // 截圖固定用觀世音菩薩
  { name: 'mine-list', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1000 };` },
  { name: 'mine-multi', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const c = document.querySelectorAll('[data-pick]'); c[0].checked = true; c[1].checked = true; await __wait(100);`,
    clip: `const t = document.querySelector('.mine-title'); t.scrollIntoView(); const r = t.getBoundingClientRect(); const b = document.querySelector('[data-cancel-picked]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: Math.min(1200, b.bottom - r.top + 16) };` },
  { name: 'resched', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const b = [...document.querySelectorAll('[data-reschedule]')].pop(); b.click(); await __wait(2000);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'change-pos', hash: '#/mine', js: `if (!window.__cpSeed) { window.__cpSeed = 1; const tk = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token; const id = (await __p({ action: 'adminCreateDuties', token: tk, duties: [{ name: '宏宗大掃除（示範）', category: '勤務', start: '2027-01-10', end: '2027-01-10', startTime: '08:00', location: '宏宗', positions: [{ name: '大殿', max: 6 }, { name: '廚房', max: 2 }, { name: '環境', max: 4 }] }] })).data.ids[0]; const dd = (await __g({ action: 'getDuty', id })).data; await __p({ action: 'signup', dutyId: id, positionId: dd.positions[0].id, dates: ['2027-01-10'], entries: [{ name: '測試甲', identity: '道親' }, { name: '王小明', identity: '道親' }] }); await __p({ action: 'signup', dutyId: id, positionId: dd.positions[1].id, dates: ['2027-01-10'], entries: [{ name: '測試乙', identity: '道親' }, { name: '測試丙', identity: '道親' }] }); }
      localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const b = document.querySelector('[data-change-pos]'); b.click(); await __wait(2000);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adjust-pos', hash: '#/mine', js: `if (!window.__adjSeed) { window.__adjSeed = 1; const tk = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token; const id = (await __p({ action: 'adminCreateDuties', token: tk, duties: [{ name: '園遊會（示範）', category: '勤務', nature: '活動', multi: true, start: '2027-01-17', end: '2027-01-17', startTime: '09:00', location: '區中心', positions: [{ name: '攤位', max: 8 }, { name: '收銀', max: 2 }, { name: '環境', max: 4 }, { name: '交通' }] }] })).data.ids[0]; const dd = (await __g({ action: 'getDuty', id })).data; for (const k of [0, 2]) await __p({ action: 'signup', dutyId: id, positionId: dd.positions[k].id, dates: ['2027-01-17'], entries: [{ name: '測試甲', identity: '道親' }] }); await __p({ action: 'signup', dutyId: id, positionId: dd.positions[1].id, dates: ['2027-01-17'], entries: [{ name: '測試乙', identity: '道親' }, { name: '測試丙', identity: '道親' }] }); }
      localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2000);
      const b = document.querySelector('[data-adjust]'); b.click(); await __wait(2000); const c = document.querySelectorAll('.modal-box input[name=adj-position]'); c[c.length - 1].click(); await __wait(300);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adm-tabs', admin: true, hash: '#/admin/more', js: `await __wait(1500);`,
    clip: `const t = document.querySelector('.admin-head'); const r = t.getBoundingClientRect(); const e = document.querySelector('.more-list').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: e.bottom - r.top + 16 };` },
  { name: 'adm-add', admin: true, hash: '#/admin/duties', js: `await __wait(2500); document.querySelector('[data-add-open]').click(); await __wait(500);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adm-person-menu', admin: true, hash: null, js: `let d = (await __g({ action: 'getEvents', from: '2027-01-24', to: '2027-01-24' })).data.duties.find((x) => x.name === '宏宗打掃（示範）');
      if (!d) { const id = (await Api.admin('adminCreateDuties', { duties: [{ name: '宏宗打掃（示範）', category: '勤務', start: '2027-01-24', end: '2027-01-24', startTime: '08:00', location: '宏宗', positions: [{ name: '大殿', max: 6 }, { name: '環境', max: 4 }] }] })).ids[0]; d = (await __g({ action: 'getDuty', id })).data; await __p({ action: 'signup', dutyId: id, positionId: d.positions[0].id, dates: ['2027-01-24'], entries: [{ name: '測試甲', identity: '道親' }, { name: '王小明', identity: '壇辦' }, { name: '測試乙', identity: '道親' }] }); }
      location.hash = '#/admin/duty/' + encodeURIComponent(d.id) + '?date=2027-01-24'; for (let i = 0; i < 30 && !document.querySelector('.act-menu summary'); i++) await __wait(300); if (!document.querySelector('.act-menu summary')) throw new Error(document.querySelector('[data-body]').innerText.slice(0, 300)); document.querySelector('.act-menu summary').click(); await __wait(400);`,
    clip: `const p = document.querySelector('.position'); p.scrollIntoView({ block: 'start' }); const r = p.getBoundingClientRect(); const m = document.querySelector('.act-menu-list').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: Math.max(r.height, m.bottom - r.top) + 16 };` },
  { name: 'adm-tidy', admin: true, hash: '#/admin/more', js: `if (!window.__tidySeed) { window.__tidySeed = 1; for (const day of ['2026-09-05', '2026-09-19']) await Api.admin('adminCreateDuties', { duties: [{ name: '區中心打掃', category: '勤務', start: day, end: day, location: '區中心', positions: [{ name: '打掃' }] }] }); }
      location.hash = '#/admin/tidy'; await __wait(2500); const q = document.querySelector('[data-q]'); q.value = '區中心'; q.dispatchEvent(new Event('input')); await __wait(300);
      for (const n of ['區中心打掃', '初一十五打掃（區中心）']) { const x = [...document.querySelectorAll('[data-name]')].find((e) => e.dataset.name === n); x.checked = true; x.dispatchEvent(new Event('change')); await __wait(300); }
      window.scrollTo(0, document.querySelector('.detail-title').getBoundingClientRect().top + scrollY - 10); await __wait(300);`,
    clip: `return { x: 0, y: scrollY, width: innerWidth, height: innerHeight };` },
  { name: 'adm-time-type', admin: true, hash: '#/admin/duties/new', js: `await __wait(2500); const set = (n, v) => { const i = document.querySelector('[name=' + n + ']'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }; set('startTime', '0830'); set('endTime', '下午9點半'); await __wait(300); const a = document.querySelector('[name=startTime]').value, b = document.querySelector('[name=endTime]').value; set('endTime', 'abc'); await __wait(200); const err = document.querySelector('[data-time-error]'); const e = err.hidden ? 'no-err' : err.textContent; set('endTime', '1200'); await __wait(200); window.__r = a + ' ' + b + ' | ' + e + ' | ' + document.querySelector('[name=endTime]').value + ' hidden=' + err.hidden; document.querySelector('.time-field').scrollIntoView({ block: 'center' }); await __wait(200); if (!/08:30 21:30/.test(window.__r) || !/12:00 hidden=true/.test(window.__r)) throw new Error('INFO ' + window.__r); console.log(window.__r);`,
    clip: `const r = document.querySelector('.time-field').closest('fieldset').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: 360 };` },
  { name: 'adm-autofill', admin: true, hash: '#/admin/duties/new', js: `await __wait(2500); const n = document.querySelector('[name=name]'); n.value = '彌勒山志工輪值'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); for (let i = 0; i < 20 && !document.querySelector('.fill-note'); i++) await __wait(300); await __wait(300); const v = (k) => (document.querySelector('[name=' + k + ']') || {}).value; const info = [v('startTime'), v('endTime'), v('location'), document.querySelectorAll('.pos-row, [data-pos], .position-row').length, (document.querySelector('.fill-note') || {}).textContent].join(' / '); if (!v('location') && !v('startTime')) throw new Error('INFO ' + info); console.log(info); document.querySelector('.fill-note').scrollIntoView({ block: 'center' }); await __wait(200);`,
    clip: `const r = document.querySelector('[name=name]').closest('.form-row').getBoundingClientRect(); const e = document.querySelector('.fill-note').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: e.bottom - r.top + 20 };` },
  { name: 'push-panel', hash: '#/', js: `PushPage.openPanel(); await __wait(1200);`, clip: `return __box('.modal-box', 4);` },
  { name: 'venue-pick', hash: '#/venue', js: `await __wait(1500); const cells = document.querySelectorAll('#view-venue [data-hour]'); if (cells[2]) { cells[2].click(); await __wait(200); document.querySelectorAll('#view-venue [data-hour]')[4].click(); } await __wait(300);`,
    clip: `const s = document.querySelector('#view-venue .venue-step, #view-venue section, #view-venue form'); return { x: 0, y: 0, width: innerWidth, height: 1100 };` },
  { name: 'venue-form', hash: '#/venue', js: `await __wait(1500); const f = document.querySelector('#view-venue form'); f.elements.name.value = '測試甲'; f.elements.phone.value = '0900-000000'; f.elements.purpose.value = '讀書會'; f.elements.people.value = '15'; f.elements.note.value = '要用投影機';`,
    clip: `const f = document.querySelector('#view-venue form'); const sec = f.closest('section') || f; return __box(f, 8);` },
  { name: 'venue-mine', hash: '#/venue', js: `await __wait(1500); const m = document.querySelector('[data-mine]'); m.elements.mname.value = '測試甲'; m.requestSubmit(); await __wait(1500);`,
    clip: `const m = document.querySelector('[data-mine]'); const sec = m.closest('section') || m.parentElement; return __box(sec, 8);` },
  { name: 'thanks-board', hash: '#/', js: `document.querySelector('[data-view=thanks]').click(); await __wait(2000);`,
    clip: `const a = document.querySelector('.thanks-head'); a.scrollIntoView(); const r = a.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: 1000 };` },
  { name: 'desc-image', hash: null, js: `const d = (await __g({ action: 'getEvents', from: '2026-08-01', to: '2027-01-31' })).data.duties.find((x) => x.name === '宏宗大掃除');
      location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(2500);
      for (let i = 0; i < 20 && !document.querySelector('#view-duty .detail-desc img'); i++) await __wait(300); await __wait(600);`,
    clip: `return __box('#view-duty .detail-desc', 10);` },
  { name: 'adm-recent', admin: true, hash: '#/admin', js: `await __wait(2000); const c = document.querySelectorAll('[data-invite-pick]'); c[0].checked = true; c[0].dispatchEvent(new Event('change')); c[1].checked = true; c[1].dispatchEvent(new Event('change')); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1300 };` },
  { name: 'adm-notify', admin: true, hash: '#/admin/day', js: `await __wait(3000); const c = document.querySelectorAll('[data-invite-row]'); c[0].click(); c[1].click(); await __wait(2500);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1500 };` },
  { name: 'adm-roster', admin: true, hash: '#/admin/roster', js: `await __wait(3000); document.querySelector('[data-all]').click(); await __wait(200);`,
    clip: `return { x: 0, y: 0, width: innerWidth, height: 1200 };` },
  { name: 'adm-push', admin: true, hash: '#/admin/push', js: `await __wait(2000); const sel = document.querySelector('select[name=duty]'); sel.selectedIndex = 5; sel.dispatchEvent(new Event('change')); await __wait(300); document.querySelector('[name=mode][value=later]').click(); await __wait(300); const q = document.querySelector('[data-quick]'); if (q) q.click(); await __wait(300);`,
    clip: `return __box('.push-form', 6);` },
  { name: 'adm-group-multi', admin: true, hash: '#/admin/duties/new', js: `await __wait(2500); const f = document.querySelector('[data-body] form'); f.elements.name.value = '大掃除'; const t = f.elements.groupType; t.value = '勤務了愿組'; t.dispatchEvent(new Event('change', { bubbles: true })); await __wait(400);
      ['第1組', '第3組', '第5組'].forEach((n) => { const c = document.querySelector('input[name=group][value="' + n + '"]'); if (c) c.checked = true; });
      document.querySelector('input[name=group]').dispatchEvent(new Event('change', { bubbles: true })); await __wait(400);`,
    clip: `const fs = [...document.querySelectorAll('fieldset.form-block')].find((x) => x.querySelector('input[name=group]')); fs.scrollIntoView({ block: 'start' }); return __box(fs, 6);` },
  { name: 'adm-pin-list', admin: true, hash: '#/admin/duties', js: `await __wait(2500); const b = document.querySelector('[data-rows] [data-pin]'); if (!b.classList.contains('is-on')) { b.click(); await __wait(1500); }`,
    clip: `const p = document.querySelector('[data-pins]'); const c = document.querySelector('[data-rows] .recent-item:nth-of-type(2)') || document.querySelector('[data-rows] .recent-item'); p.scrollIntoView({ block: 'start' }); const r = p.getBoundingClientRect(); const e = c.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: e.bottom - r.top + 12 };` },
  { name: 'adm-mypw', admin: true, hash: '#/admin', js: `await __wait(1500); document.querySelector('[data-mypw]').click(); await __wait(500);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adm-venue', admin: true, hash: '#/admin/venue', js: `await __wait(2000);`,
    clip: `const el = document.querySelector('.venue-reqs'); return __box(el.closest('[data-body]') || el, 4);` },
  { name: 'adm-venue-cancel', admin: true, hash: '#/admin/venue', js: `await __wait(2000);
      const b = [...document.querySelectorAll('[data-cancel]')].find((x) => x.textContent.includes('可選哪幾天')); b.click(); await __wait(600);
      const c = document.querySelectorAll('.modal-box [data-day]'); c[c.length - 1].click(); await __wait(200);
      document.querySelector('.modal-box [name=note]').value = '那天區中心有活動';`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adm-thanks', admin: true, hash: null, js: `const d = (await __g({ action: 'getEvents', from: '2026-08-01', to: '2027-01-31' })).data.duties.find((x) => x.name === '12人小組輪值');
      location.hash = '#/admin/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(2500);
      document.querySelector('[data-thanks]').click(); for (let i = 0; i < 30 && !document.querySelector('.thanks-preview'); i++) await __wait(300); await __wait(1500);`,
    clip: `return __box('.modal-box', 4);` },
  { name: 'adm-desc-image', admin: true, hash: null, js: `const d = (await __g({ action: 'getEvents', from: '2026-08-01', to: '2027-01-31' })).data.duties.find((x) => x.name === '宏宗大掃除');
      location.hash = '#/admin/duties/edit/' + encodeURIComponent(d.id); await __wait(2500);
      const ta = document.querySelector('textarea[name=description]'); ta.rows = 6; ta.focus(); const at = ta.value.indexOf('![') + 2; ta.setSelectionRange(at, at); await __wait(200);`,
    clip: `const ta = document.querySelector('textarea[name=description]'); const row = ta.closest('label, .form-row') || ta.parentElement; row.scrollIntoView({ block: 'start' }); const r = row.getBoundingClientRect(); const h = (ta.closest('form').querySelector('.desc-tools') || ta).parentElement.querySelector('.hint') || ta; const e = h.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: Math.max(e.bottom, ta.getBoundingClientRect().bottom) - r.top + 20 };` }
];

// ---------- 分區：開通頁、⚙️ 區設定（只有其他區有） ----------
// 測試版的教捨區（she）已開通、密碼 test-pass；開通頁用測試版的開通工具（金鑰 test-key）幫教發區（fa）拿一個開通連結。
const REGION_SHOTS = ['adm-setup', 'adm-site', 'adm-site-features'];
async function regionShots(c, only) {
  const want = (n) => !only.length || only.indexOf(n) !== -1;
  if (!REGION_SHOTS.some(want)) return;
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5500); };
  if (want('adm-setup')) {
    const res = await fetch(BASE + 'region-admin', { method: 'POST', body: JSON.stringify({ key: 'test-key', region: 'fa' }) }).then((r) => r.json());
    if (!res.ok) throw new Error('開通工具：' + JSON.stringify(res.error));
    await go(res.data.link);
    await shot(c, path.join(OUT, 'adm-setup.png'), PREP + `return __box('#view-setup .admin-login', 6);`);
    console.log('✓ adm-setup');
  }
  if (!want('adm-site') && !want('adm-site-features')) return;
  await go(BASE + 'she/#/admin');
  await run(c, PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }
    location.hash = '#/admin/site'; await __wait(2500);
    const f = document.querySelector('[data-body] form'); f.elements.locations.value = '區中心\\n佛堂\\n活動中心'; f.elements.contact.value = '總務組';`);
  if (want('adm-site')) {
    await shot(c, path.join(OUT, 'adm-site.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView({ block: 'start' }); const r = b.getBoundingClientRect(); const e = document.querySelector('.site-cats').getBoundingClientRect();
      return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: e.bottom - r.top + 16 };`);
    console.log('✓ adm-site');
  }
  if (want('adm-site-features')) {
    await shot(c, path.join(OUT, 'adm-site-features.png'), PREP + `const box = document.querySelector('[name=f-venue]').closest('.form-row'); box.scrollIntoView({ block: 'center' }); const r = box.getBoundingClientRect(); const s = document.querySelector('[data-body] form [type=submit]').getBoundingClientRect();
      return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: s.bottom - r.top + 20 };`);
    console.log('✓ adm-site-features');
  }
}

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
    await run(c, PREP + SEED2);
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
    await regionShots(c, only);
  } finally {
    c.close();
    proc.kill();
  }
}

// 給 tools/tutorial-shots.js 共用
module.exports = { launch, client, run, sleep, PREP, SEED, BASE };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
