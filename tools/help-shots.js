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
  // 教育統計：各年齡層適合的班（2026/11/23）
  { name: 'edu-age-classes', admin: true, hash: '#/admin/stats', js: `for (const [n, b] of [['測試幼兒', 2021], ['測試小二', 2019], ['測試小四', 2017], ['測試國二', 2013], ['測試高二', 2010], ['測試青年', 1996], ['測試長輩', 1958]]) { try { await Api.admin('adminSaveMember', { member: { name: n, identity: '道親', birth: String(b), groups: {}, active: true } }); } catch (e) {} } location.hash = '#/admin/groups'; await __wait(300); location.hash = '#/admin/stats'; for (let i = 0; i < 30 && !document.querySelector('input[name=scat]'); i++) await __wait(300); [...document.querySelectorAll('input[name=scat]')].find((x) => x.value === '教育').click(); for (let i = 0; i < 30 && !document.querySelector('[data-age-open]'); i++) await __wait(300); document.querySelector('[data-age-open]').click(); await __wait(600);`, clip: `return __box('[data-age-classes]', 6);` },
  // 教育組的關心名單（2026/11/23）：高三、壽星、已關心一位
  { name: 'edu-care', admin: true, hash: '#/admin/stats', js: `const t = new Date(Date.now() + 8 * 3600000); const md = (d) => String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); const soon = new Date(t.getTime() + 2 * 86400000); const y = t.getUTCFullYear(); const acad = t.getUTCMonth() >= 8 ? y : y - 1; for (const [n, b] of [['測試高三甲', String(acad - 17)], ['測試高三乙', String(acad - 17)], ['測試壽星', (y - 9) + '/' + md(soon).replace('-', '/')], ['測試青年壽星', (y - 28) + '/' + md(t).replace('-', '/')]]) { try { await Api.admin('adminSaveMember', { member: { name: n, identity: '道親', birth: b, groups: {}, active: true } }); } catch (e) {} } await Api.admin('adminEduCare', { key: '測試高三乙|g12|' + acad + '-' + (md(t) >= '02-01' && md(t) < '09-01' ? 2 : 1), name: '測試高三乙', label: '高三：今年考學測、升大學', note: '送了平安符' }); location.hash = '#/admin/groups'; await __wait(300); location.hash = '#/admin/stats'; for (let i = 0; i < 30 && !document.querySelector('input[name=scat]'); i++) await __wait(300); [...document.querySelectorAll('input[name=scat]')].find((x) => x.value === '教育').click(); for (let i = 0; i < 40 && !document.querySelector('.ecare-group'); i++) await __wait(300); if (!document.querySelector('.ecare-group')) throw new Error('INFO ' + document.querySelector('[data-edu-care]').innerText.slice(0, 200)); document.querySelector('[data-care-all]').click(); await __wait(400);`, clip: `const a = document.querySelector('[data-edu-care]'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = [...a.querySelectorAll('.admin-actions')].pop().getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: e.bottom - r.top + 12 };` },
  // 📸 活動相簿（2026/11/23）：過去的勤務放三張照片、一個相簿連結
  { name: 'album', hash: null, js: `const res = (await __g({ action: 'getEvents', from: '2026-10-01', to: res0Today() })).data; function res0Today() { const t = new Date(Date.now() + 8 * 3600000); return t.toISOString().slice(0, 10); } const d = res.duties.filter((x) => x.start <= res.today && x.mode !== '公告型').pop(); const mk = (color, text) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 400, 300); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(text, 90, 165); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; }; const have = ((await Api.album(d.id)).dates[d.start] || { photos: [] }).photos.length; if (!have) { for (const [c, t] of [['#9e3d22', '大家合照'], ['#4d6b4f', '佈置會場'], ['#3b6ea5', '活動花絮'], ['#8a6d3b', '感恩分享']]) { const b = mk(c, t); await Api.albumUpload({ dutyId: d.id, date: d.start, by: '測試甲', mime: 'image/jpeg', data: b, thumb: b }); } await Api.albumLink({ dutyId: d.id, date: d.start, by: '測試乙', url: 'https://photos.example.com/album/demo', label: 'LINE 相簿（全部照片）' }); } location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(3000); const s = document.querySelector('#view-duty [data-album]') || document.querySelector('[data-album]'); for (let i = 0; i < 30 && !s.querySelector('.album-thumb'); i++) await __wait(300); s.scrollIntoView(); await __wait(800);`, clip: `const s = document.querySelector('#view-duty [data-album]') || document.querySelector('[data-album]'); return __box(s, 6);` },
  // 新朋友要填佛堂、生日（2026/11/23）
  { name: 'signup-newcomer', hash: null, js: `const res = (await __g({ action: 'getEvents', from: '2026-10-13', to: '2027-03-30' })).data; const d = res.duties.find((x) => x.name.includes('志工輪值') && x.start > res.today); location.hash = '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.start; await __wait(2500); const inp = document.querySelector('#view-duty input[type=text], #view-duty input:not([type])'); inp.value = '測試新朋友'; inp.dispatchEvent(new Event('input', { bubbles: true })); await __wait(300); [...document.querySelectorAll('#view-duty button')].find((b) => b.textContent.trim() === '加入').click(); await __wait(400); document.querySelector('#view-duty form').requestSubmit(); await __wait(800); const r = [...document.querySelectorAll('.modal-box input[type=radio]')].find((x) => x.value === '未求道'); if (r) { r.click(); await __wait(200); document.querySelector('[data-ask-ok]').click(); } for (let i = 0; i < 30 && !document.querySelector('[data-nc-birth]'); i++) await __wait(300); const b = document.querySelector('[data-nc-birth]'); b.value = '1991/5/6'; b.dispatchEvent(new Event('input')); document.querySelector('[data-nc-temple]').value = '__none__'; await __wait(300);`, clip: `return __box('.modal-box', 4);` },
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
  { name: 'adm-multi-add', admin: true, hash: null, js: `let d = (await __g({ action: 'getEvents', from: '2027-01-24', to: '2027-01-24' })).data.duties.find((x) => x.name === '宏宗打掃（示範）');
      if (!d) { const id = (await Api.admin('adminCreateDuties', { duties: [{ name: '宏宗打掃（示範）', category: '勤務', start: '2027-01-24', end: '2027-01-24', startTime: '08:00', location: '宏宗', positions: [{ name: '大殿', max: 6 }, { name: '環境', max: 4 }] }] })).ids[0]; d = (await __g({ action: 'getDuty', id })).data; }
      location.hash = '#/admin/duty/' + encodeURIComponent(d.id) + '?date=2027-01-24'; for (let i = 0; i < 30 && !document.querySelector('[data-walkin]'); i++) await __wait(300); document.querySelectorAll('[data-walkin]')[1].click(); await __wait(800);
      const inp = document.querySelector('.modal-form [name=name]'); inp.value = '試甲、王小明、'; inp.dispatchEvent(new Event('input', { bubbles: true })); await __wait(200); inp.value = '測試新朋友'; inp.dispatchEvent(new Event('input', { bubbles: true })); await __wait(200); document.querySelector('[data-add-name]').click(); await __wait(200);
      const r = document.querySelector('.modal-form input[name=id-2][value=未求道]'); if (!r) throw new Error('INFO ' + document.querySelector('.modal-form').innerText.replace(/s+/g, ' ')); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); await __wait(200); if (document.querySelectorAll('.modal-form .identity-fixed').length < 2 || !document.querySelector('.modal-form .name-typed')) throw new Error('INFO no fixed: ' + document.querySelector('.modal-form').innerText.replace(/s+/g, ' '));
      const n = document.querySelectorAll('.modal-form .name-item').length; if (n !== 3) throw new Error('INFO items=' + n); console.log(document.querySelector('[data-submit]').textContent);`,
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
  { name: 'adm-merge', admin: true, hash: '#/admin/duties/new', js: `await __wait(2500); const r = await Api.admin('adminDutyList', {}, true); const d = (r.duties || []).filter((x) => x.start).sort((a, b) => a.start.localeCompare(b.start)).pop(); const st = document.querySelector('[name=start]'); st.value = d.start; st.dispatchEvent(new Event('input', { bubbles: true })); st.dispatchEvent(new Event('change', { bubbles: true })); await __wait(400); const sel = document.querySelector('[data-merge-pick]'); const g = sel.querySelector('optgroup[label="同一天有的"]'); if (!g) throw new Error('INFO no same-day group for ' + d.start); sel.value = g.querySelector('option').value; sel.dispatchEvent(new Event('change', { bubbles: true })); window.__r = d.start + ' → ' + sel.value + ' / ' + [...sel.options].length + ' options'; console.log(window.__r); sel.closest('fieldset').scrollIntoView({ block: 'center' }); await __wait(200);`, clip: `return __box(document.querySelector('[data-merge-pick]').closest('fieldset'), 8);` },
  { name: 'adm-member-suggest', admin: true, hash: '#/admin/duties/new', js: `await __wait(2500); for (const [n, id] of [['測試講師甲', '壇辦'], ['測試講師乙', '道親']]) { try { await Api.admin('adminSaveMember', { member: { name: n, identity: id } }); } catch (e) { /* 已經有了 */ } } const cat = document.querySelector('input[name=category][value=道務]'); if (!cat) throw new Error('INFO no 道務'); cat.checked = true; cat.dispatchEvent(new Event('change', { bubbles: true })); await __wait(500); const i = document.querySelector('[name=lecturers]'); i.focus(); i.value = '王小明、講師'; i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new Event('input', { bubbles: true })); for (let k = 0; k < 20 && !document.querySelector('.member-sug .suggestion'); k++) await __wait(200); if (!document.querySelector('.member-sug .suggestion')) throw new Error('INFO no suggestions'); i.closest('fieldset').scrollIntoView({ block: 'center' }); await __wait(200);`,
    clip: `return __box(document.querySelector('[name=lecturers]').closest('fieldset'), 8);` },
  { name: 'adm-import-members', admin: true, hash: '#/admin/members', js: `for (let i = 0; i < 30 && !document.querySelector('[data-import-members]'); i++) await __wait(300); document.querySelector('[data-import-members]').click(); await __wait(500); const d = document.querySelector('.import-paste'); d.open = true; document.querySelector('[data-text]').value = '編號\\t姓名\\t所屬佛堂\\t出生年月日\\t身份\\t清口\\n1\\t測試甲\\t宏宗\\t54/3/2\\t壇主\\tV\\n2\\t王小明\\t\\t1972/5/1\\t道親\\t\\n3\\t測試新朋友\\t宏宗\\t88/1/1\\t新朋友\\t'; document.querySelector('[data-read-text]').click(); await __wait(400); d.open = false; if (!document.querySelector('.import-preview')) throw new Error('INFO ' + document.querySelector('[data-out]').innerText);`,
    clip: `const o = document.querySelector('[data-out]'); o.scrollIntoView({ block: 'center' }); const r = o.getBoundingClientRect(); const t = document.querySelector('.import-src').getBoundingClientRect(); const y = Math.max(0, Math.min(t.bottom - 140, r.top - 10)); return { x: r.left - 12 + scrollX, y: y + scrollY, width: r.width + 24, height: Math.min(r.bottom + 10 - y, 900) };` },
  { name: 'adm-youth', admin: true, hash: '#/admin/members', js: `await __wait(1500); const __fam = async () => { const have = (await Api.admin('adminMembers', {}, true)).members; const add = async (name, identity, age, parents, school, interest) => { if (have.some((x) => x.name === name)) return; await Api.admin('adminSaveMember', { member: { name, identity, age, parents, school, interest, groups: {}, active: true } }); }; await add('測試阿公', '壇辦', '72', '', '', ''); await add('測試爸爸', '道親', '42', '測試阿公', '', ''); await add('測試媽媽', '壇辦', '40', '', '', ''); await add('測試小孩甲', '道親', '9', '測試爸爸、測試媽媽', '測試國小', '畫畫、打鼓'); await add('測試小孩乙', '道親', '13', '測試爸爸、測試媽媽', '測試國中', '籃球'); await add('測試鄰居小孩', '未求道', '6', '', '', ''); AdminPage.clearMemo(); }; await __fam(); location.hash = '#/admin/youth'; for (let i = 0; i < 30 && !document.querySelector('[data-yrow]'); i++) await __wait(300); if (!document.querySelector('.tag-gen')) throw new Error('INFO ' + document.querySelector('[data-body]').innerText.slice(0, 300));`,
    clip: `const a = document.querySelector('.youth-sum'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = document.querySelector('[data-yrows]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 70, width: innerWidth, height: Math.min(1300, e.bottom - r.top + 80) };` },
  { name: 'adm-family-edit', admin: true, hash: '#/admin/members', js: `await __wait(1500); const __fam = async () => { const have = (await Api.admin('adminMembers', {}, true)).members; const add = async (name, identity, age, parents, school, interest) => { if (have.some((x) => x.name === name)) return; await Api.admin('adminSaveMember', { member: { name, identity, age, parents, school, interest, groups: {}, active: true } }); }; await add('測試阿公', '壇辦', '72', '', '', ''); await add('測試爸爸', '道親', '42', '測試阿公', '', ''); await add('測試媽媽', '壇辦', '40', '', '', ''); await add('測試小孩甲', '道親', '9', '測試爸爸、測試媽媽', '測試國小', '畫畫、打鼓'); await add('測試小孩乙', '道親', '13', '測試爸爸、測試媽媽', '測試國中', '籃球'); await add('測試鄰居小孩', '未求道', '6', '', '', ''); AdminPage.clearMemo(); }; await __fam(); location.hash = '#/admin/groups'; await __wait(300); location.hash = '#/admin/members'; for (let i = 0; i < 30 && !document.querySelector('[data-q]'); i++) await __wait(300); const q = document.querySelector('[data-q]'); q.value = '測試小孩甲'; q.dispatchEvent(new Event('input', { bubbles: true })); await __wait(400); document.querySelector('.person-card').click(); await __wait(700); const fb = document.querySelector('.family-block'); if (!fb) throw new Error('INFO no family block'); fb.scrollIntoView({ block: 'center' }); await __wait(300);`,
    clip: `return __box('.family-block', 8);` },
  { name: 'adm-assign-groups', admin: true, hash: '#/admin/groups', js: `for (let i = 0; i < 30 && !document.querySelector('[data-assign]'); i++) await __wait(300); for (const n of ['測試組員甲', '測試組員乙', '測試組員丙']) { try { await Api.admin('adminSaveMember', { member: { name: n, identity: '道親', groups: {}, active: true } }); } catch (e) {} } document.querySelector('[data-assign]').click(); await __wait(500); const sel = document.querySelector('[data-type]'); const t = [...sel.options].find((o) => o.value === '打掃組'); if (t) { sel.value = '打掃組'; sel.dispatchEvent(new Event('change', { bubbles: true })); } const have = document.querySelector('[data-have]').textContent; const g = (have.split('：')[1] || '').split('、').filter(Boolean); if (g.length < 2) throw new Error('INFO ' + have); document.querySelector('[data-text]').value = g[0] + '：測試組員甲、測試組員乙、不在名單的人\\n' + g[1] + '：測試組員丙'; document.querySelector('[data-check]').click(); for (let i = 0; i < 20 && !document.querySelector('[data-out] p'); i++) await __wait(300); await __wait(300);`,
    clip: `const a = document.querySelector('[data-text]'); a.rows = 3; const o = document.querySelector('[data-out]'); o.scrollIntoView({ block: 'end' }); const r1 = document.querySelector('[data-type]').closest('.form-row').getBoundingClientRect(); const r2 = o.getBoundingClientRect(); return { x: r2.left - 12 + scrollX, y: r1.top - 10 + scrollY, width: r2.width + 24, height: r2.bottom - r1.top + 20 };` },
  { name: 'adm-missing', admin: true, hash: '#/admin/members', js: `for (const [n, t, a] of [['測試資料甲', '', '30'], ['測試資料乙', '宏宗', ''], ['測試資料丙', '', '']]) { try { await Api.admin('adminSaveMember', { member: { name: n, identity: '道親', temple: t, age: a, groups: {}, active: true } }); } catch (e) {} } AdminPage.clearMemo(); location.hash = '#/admin/groups'; await __wait(300); location.hash = '#/admin/members'; for (let i = 0; i < 30 && !document.querySelector('[data-missing]'); i++) await __wait(300); const s = document.querySelector('[data-missing]'); s.value = 'any'; s.dispatchEvent(new Event('change', { bubbles: true })); await __wait(400); if (!document.querySelector('.people-list .tag-warn')) throw new Error('INFO ' + document.querySelector('[data-rows]').innerText.slice(0, 200));`,
    clip: `const a = document.querySelector('.list-filter'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = document.querySelector('[data-rows]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: Math.min(1000, e.bottom - r.top + 20) };` },
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
const REGION_SHOTS = ['adm-setup', 'adm-site', 'adm-site-features', 'adm-onboarding', 'adm-templates'];
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
  if (!want('adm-site') && !want('adm-site-features') && !want('adm-onboarding') && !want('adm-templates')) return;
  await go(BASE + 'she/#/admin');
  await run(c, PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`);
  if (want('adm-onboarding')) {
    await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.onboard'); i++) await __wait(300); await __wait(300);`);
    await shot(c, path.join(OUT, 'adm-onboarding.png'), PREP + `return __box('.onboard', 6);`);
    console.log('✓ adm-onboarding');
  }
  if (want('adm-templates')) {
    await run(c, PREP + `location.hash = '#/admin/duties'; for (let i = 0; i < 30 && !document.querySelector('[data-add-open]'); i++) await __wait(300); document.querySelector('[data-add-open]').click(); await __wait(400); document.querySelector('[data-way-tpl]').click(); for (let i = 0; i < 30 && !document.querySelector('[data-tpl]'); i++) await __wait(300); await __wait(300);`);
    await shot(c, path.join(OUT, 'adm-templates.png'), PREP + `return __box('.modal-box', 4);`);
    console.log('✓ adm-templates');
    await run(c, PREP + `document.querySelector('[data-tpl]').click(); for (let i = 0; i < 30 && !document.querySelector('.fill-note'); i++) await __wait(300); window.__tplInfo = [document.querySelector('[name=name]').value, document.querySelector('[name=startTime]').value, document.querySelector('[name=location]').value].join(' / '); if (!document.querySelector('.fill-note')) throw new Error('範本沒有帶入'); console.log(window.__tplInfo);`);
  }
  if (!want('adm-site') && !want('adm-site-features')) return;
  await run(c, PREP + `
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

// 宏教分壇分派（2026/11/22）：分壇開分派 → 教捨區收件匣、放到行事曆 → 報名 → 分壇總表（測試版的分壇 hq、教捨區 she 都已開通，密碼 test-pass）
const HQ_SHOTS = ['hq-form', 'hq-summary-new', 'hq-inbox-note', 'hq-inbox-page', 'hq-inbox-open', 'hq-summary', 'hq-list', 'hq-import', 'hq-drafts', 'hq-group', 'hq-inbox-group', 'hq-overview', 'hq-stats', 'hq-accounts', 'hq-notice', 'hq-inbox-notice', 'hq-reply', 'hq-replies', 'hq-answer', 'hq-remind', 'hq-inbox-reply', 'hq-notices', 'hq-tpl-save', 'hq-copy', 'hq-tpls', 'hq-tpl-form', 'hq-support-ask', 'hq-support-answer', 'hq-support-in'];
async function hqShots(c, only) {
  const want = (n) => !only.length || only.indexOf(n) !== -1;
  if (!HQ_SHOTS.some(want)) return;
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5000); };
  const login = PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`;
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  if (['hq-form', 'hq-summary-new', 'hq-inbox-note', 'hq-inbox-page', 'hq-inbox-open', 'hq-summary'].some(want)) await hqLoop();
  async function hqLoop() {
  await run(c, PREP + `location.hash = '#/admin/hq/new'; for (let i = 0; i < 30 && !document.querySelector('.hq-form'); i++) await __wait(300);
    const f = document.querySelector('.hq-form'); const set = (n, v) => { f.elements[n].value = v; };
    set('title', '測試分壇大典（示範）'); set('start', '2027-02-14'); set('startTime', '0800'); set('endTime', '1200'); set('location', '測試地點');
    set('description', '請各區派人支援接待、引導。'); set('positions', '接待、引導'); set('deadline', '2027-02-07');
    f.querySelectorAll('input[name=regions]').forEach((x) => { x.checked = x.value === 'main' || x.value === 'she' || x.value === 'ding'; });
    f.querySelector('input[name=quotaMode][value=assigned]').click(); await __wait(400);
    const f3 = document.querySelector('.hq-form'); f3.elements['q-main'].value = '10'; f3.elements['q-she'].value = '6'; if (f3.elements['q-ding']) f3.elements['q-ding'].value = '5';`);
  if (want('hq-form')) {
    await shot(c, path.join(OUT, 'hq-form.png'), PREP + `const f = document.querySelector('.hq-form'); const a = f.querySelector('[name=title]').closest('.form-row'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = f.querySelector('[type=submit]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: Math.min(2600, e.bottom - r.top + 20) };`);
    console.log('✓ hq-form');
  }
  await run(c, PREP + `document.querySelector('.hq-form').requestSubmit(); for (let i = 0; i < 40 && !document.querySelector('.hq-table'); i++) await __wait(300); if (!document.querySelector('.hq-table')) throw new Error('INFO ' + document.querySelector('[data-body]').innerText.slice(0, 300)); window.__hqId = location.hash.split('/').pop(); localStorage.setItem('hq-shot-id', window.__hqId);`);
  if (want('hq-summary-new')) {
    await shot(c, path.join(OUT, 'hq-summary-new.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(1600, r.height + 12) };`);
    console.log('✓ hq-summary-new');
  }
  // 教捨區：首頁的提醒、收件匣、放到行事曆
  await go(BASE + 'she/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-alert'); i++) await __wait(300); if (!document.querySelector('.hq-alert')) throw new Error('INFO 沒有分派提醒');`);
  if (want('hq-inbox-note')) {
    await shot(c, path.join(OUT, 'hq-inbox-note.png'), PREP + `return __box('.hq-alert', 6);`);
    console.log('✓ hq-inbox-note');
  }
  // 上方「📥 分壇分派 ❗1」分頁＋收件匣（同名的一組）
  await run(c, PREP + `location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('[data-open]'); i++) await __wait(300); if (!document.querySelector('[data-hq-tab] .tab-alert')) throw new Error('INFO 分頁沒有驚嘆號'); await __wait(300);`);
  if (want('hq-inbox-page')) {
    await shot(c, path.join(OUT, 'hq-inbox-page.png'), PREP + `const a = document.querySelector('.admin-tabs').getBoundingClientRect(); const b = document.querySelector('.hq-inbox-groups').getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 6, width: innerWidth, height: b.bottom - a.top + 16 };`);
    console.log('✓ hq-inbox-page');
  }
  await run(c, PREP + `document.querySelector('[data-open]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box form'); i++) await __wait(300); await __wait(300); document.querySelector('.modal-box [name=note]').value = '本區 7:30 在區中心集合，一起坐車。';`);
  if (want('hq-inbox-open')) {
    await shot(c, path.join(OUT, 'hq-inbox-open.png'), PREP + `return __box('.modal-box', 4);`);
    console.log('✓ hq-inbox-open');
  }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !document.querySelector('[data-body] .notice-success'); i++) await __wait(300); if (!document.querySelector('[data-body] .notice-success')) throw new Error('INFO 放不上去：' + (document.querySelector('.modal-box') || document.body).innerText.slice(0, 300));
    const rapi = Region.api(location.origin + '/api'); const rg = (q) => fetch(rapi + '&' + new URLSearchParams(q)).then((r) => r.json()); const rp = (b) => fetch(rapi, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) }).then((r) => r.json());
    const ev = (await rg({ action: 'getEvents', from: '2027-02-14', to: '2027-02-14' })).data.duties.find((d) => d.fromHq);
    if (!ev) throw new Error('INFO 行事曆上沒有');
    const sr = await rp({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2027-02-14'], entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '壇辦' }] }); if (!sr.ok) throw new Error('INFO 報名失敗 ' + JSON.stringify(sr.error));`);
  // 分壇總表
  await go(BASE + 'hq/#/admin');
  await run(c, PREP + `location.hash = '#/admin/hq/' + localStorage.getItem('hq-shot-id'); for (let i = 0; i < 40 && !document.querySelector('.hq-table'); i++) await __wait(300); await __wait(300);`);
  if (want('hq-summary')) {
    await shot(c, path.join(OUT, 'hq-summary.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(1600, r.height + 12) };`);
    console.log('✓ hq-summary');
  }
  }
  // 從檔案匯入（測試版沒有 AI 金鑰：AI 的回答換成假的，看畫面、農曆換算、存草稿）
  const supW = ["hq-support-ask","hq-support-answer","hq-support-in"].some(want);
  const tplW = ["hq-tpl-save","hq-copy","hq-tpls","hq-tpl-form"].some(want);
  const talk = ["hq-notice","hq-inbox-notice","hq-reply","hq-replies","hq-answer","hq-remind","hq-inbox-reply","hq-notices"].some(want);
  if (want('hq-import') || want('hq-drafts') || want('hq-group') || want('hq-inbox-group') || want('hq-overview') || want('hq-stats') || want('hq-accounts') || talk || tplW || supW) {
    await run(c, PREP + `location.hash = '#/admin/hq/import'; for (let i = 0; i < 30 && !document.querySelector('[data-files]'); i++) await __wait(300);
      const orig = Api.admin; Api.admin = (a, p, r) => (a === 'hqImportAi' ? new Promise((ok) => setTimeout(() => ok({ items: [
        { title: '測試分壇法會', category: '道務', start: '2027-03-05', startTime: '0900', endTime: '12:00', location: '測試地點', description: '各區道親參加' },
        { title: '測試初一班', category: '道務', lunarDate: '二月初一', lunarYear: 2027, startTime: '19:30' },
        { title: '測試大掃除', category: '勤務', start: '2027-01-17', location: '測試地點', regions: ['仁孝'], uncertain: ['時間看不清楚'] },
        { title: '測試大掃除', category: '勤務', start: '2027-01-24', location: '測試地點', regions: ['志美'] },
        { title: '測試過去的活動', category: '勤務', start: '2026-01-10' }] }), 300)) : orig(a, p, r));
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300; cv.getContext('2d').fillRect(0, 0, 10, 10);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], '測試行事曆.png', { type: 'image/png' }));
      const fin = document.querySelector('[data-files]'); fin.files = dt.files; fin.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-read]').click(); for (let i = 0; i < 40 && !document.querySelector('.hq-import-row'); i++) await __wait(300);
      const rows = [...document.querySelectorAll('.hq-import-row')]; if (rows.length !== 5) throw new Error('INFO rows=' + rows.length + ' ' + document.querySelector('[data-progress]').innerText);
      const lunar = rows.find((x) => x.closest('.hq-import-group').querySelector('[data-gk=title]').value === '測試初一班').querySelector('[data-k=start]').value;
      const past = rows.find((x) => x.closest('.hq-import-group').querySelector('[data-gk=title]').value === '測試過去的活動').querySelector('[data-k=pick]').checked;
      const to = rows.find((x) => x.closest('.hq-import-group').querySelector('[data-gk=title]').value === '測試大掃除').querySelector('.hq-import-to strong').textContent; if (to !== '教孝、教仁' && to !== '教仁、教孝') throw new Error('INFO to=' + to); window.__info = 'lunar=' + lunar + ' pastPicked=' + past; if (lunar !== '2027-03-08' || past) throw new Error('INFO ' + window.__info);`);
    if (want('hq-import')) {
      await shot(c, path.join(OUT, 'hq-import.png'), PREP + `const a = document.querySelector('[data-progress]'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = document.querySelector('[data-save]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 10, width: innerWidth, height: Math.min(2600, e.bottom - r.top + 20) };`);
      console.log('✓ hq-import');
    }
    await run(c, PREP + `document.querySelector('[data-save]').click(); for (let i = 0; i < 30 && !document.querySelector('.hq-card.is-draft'); i++) await __wait(300); if (document.querySelectorAll('.hq-card.is-draft').length < 3) throw new Error('INFO drafts=' + document.querySelectorAll('.hq-card.is-draft').length); await __wait(1000);`);
    if (want('hq-drafts')) {
      await shot(c, path.join(OUT, 'hq-drafts.png'), PREP + `const b = document.querySelector('.admin-actions'); b.scrollIntoView(); const r = b.getBoundingClientRect(); const e = document.querySelector('.card-list').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 70, width: innerWidth, height: Math.min(1400, e.bottom - r.top + 80) };`);
      console.log('✓ hq-drafts');
    }
    // 各區：同一個活動好幾個日期，整組一次放到行事曆
    if (want('hq-inbox-group') || want('hq-overview') || want('hq-stats') || want('hq-accounts') || talk || tplW || supW) {
      await run(c, PREP + `let r = await Api.admin('hqSaveDrafts', { items: ['2027-03-07', '2027-03-14', '2027-03-21'].map((d) => ({ title: '測試志工輪值', category: '勤務', start: d, startTime: '08:00', endTime: '12:00', location: '測試地點', regions: ['main', 'she'], quotaMode: 'assigned', quotas: { main: 3, she: 2 } })) });
        const ds = (await Api.admin('hqList', {})).campaigns.filter((x) => x.title === '測試志工輪值' && x.status === 'draft'); r = await Api.admin('hqSaveMany', { items: ds.map((x) => Object.assign({}, x, { positions: [{ name: '輪值' }] })) }); if (r.sent !== 3) throw new Error('INFO sent=' + r.sent);`);
      await go(BASE + 'she/#/admin');
      await run(c, login);
      await run(c, PREP + `location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('[data-group-pub]'); i++) await __wait(300); if (!document.querySelector('[data-group-pub]')) throw new Error('INFO 沒有整組按鈕'); await __wait(300);`);
      if (want('hq-inbox-group')) {
        await shot(c, path.join(OUT, 'hq-inbox-group.png'), PREP + `const s = document.querySelector('[data-group-pub]').closest('section'); s.scrollIntoView(); return __box(s, 6);`);
        console.log('✓ hq-inbox-group');
      }
      await run(c, PREP + `document.querySelector('[data-group-pub]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box form'); i++) await __wait(300); document.querySelector('.modal-box [name=note]').value = '測試集合說明'; document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !document.querySelector('[data-body] .notice-success'); i++) await __wait(300);
        const t = (document.querySelector('[data-body] .notice-success') || {}).innerText || ''; if (!/3 個日期/.test(t)) throw new Error('INFO ' + t + document.body.innerText.slice(0, 200));`);
      await go(BASE + 'hq/#/admin');
      await run(c, login);
      await run(c, PREP + `await __wait(800); const card = [...document.querySelectorAll('.hq-card')].find((x) => /測試志工輪值/.test(x.textContent) && /整組總覽/.test(x.textContent)); if (!card) throw new Error('INFO 沒有整組卡'); card.click(); for (let i = 0; i < 40 && !document.querySelector('.ov-table'); i++) await __wait(300); if (!document.querySelector('.ov-table')) throw new Error('INFO 沒有總覽表'); await __wait(300);`);
      if (want('hq-overview')) {
        await shot(c, path.join(OUT, 'hq-overview.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(1800, r.height + 12) };`);
        console.log('✓ hq-overview');
      }
      if (want('hq-stats')) {
        await run(c, PREP + `location.hash = '#/admin/hqstats'; for (let i = 0; i < 30 && !document.querySelector('input[name=period]'); i++) await __wait(300); document.querySelector('input[name=period][value=custom]').click(); const fi = document.querySelector('input[name=from]'); fi.value = '2026-01-01'; fi.dispatchEvent(new Event('change')); const ti = document.querySelector('input[name=to]'); ti.value = '2027-12-31'; ti.dispatchEvent(new Event('change')); for (let i = 0; i < 40 && !document.querySelector('.hq-tiles'); i++) await __wait(300); if (!document.querySelector('.hq-tiles')) throw new Error('INFO ' + document.querySelector('[data-body]').innerText.slice(0, 200)); await __wait(300);`);
        await shot(c, path.join(OUT, 'hq-stats.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(2400, r.height + 12) };`);
        console.log('✓ hq-stats');
      }
      if (want('hq-accounts')) {
        await run(c, PREP + `location.hash = '#/admin/accounts'; for (let i = 0; i < 40 && !document.querySelector('[data-new]'); i++) await __wait(300); document.querySelector('[data-new]').click(); for (let i = 0; i < 30 && !document.querySelector('.role-pick'); i++) await __wait(300); await __wait(300);`);
        await shot(c, path.join(OUT, 'hq-accounts.png'), PREP + `return __box(document.querySelector('.role-pick').closest('form, .modal-box'), 6);`);
        console.log('✓ hq-accounts');
      }
      if (talk) { await talkShots(c, want); await go(BASE + 'hq/#/admin'); await run(c, login); }
      if (tplW) { await tplShots(c, want); await go(BASE + 'hq/#/admin'); await run(c, login); }
      if (supW) { await supportShots(c, want); await go(BASE + 'hq/#/admin'); await run(c, login); }
    }
    // 同名草稿一起檢查、一起送出
    if (want('hq-group')) {
      await run(c, PREP + `location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-card'); i++) await __wait(300); await __wait(500); const card = [...document.querySelectorAll('.hq-card.is-draft')].find((x) => /測試大掃除/.test(x.textContent)); if (!card || !/2 個日期/.test(card.textContent)) throw new Error('INFO card=' + (card && card.textContent)); card.click(); for (let i = 0; i < 30 && !document.querySelector('.hq-group-dates'); i++) await __wait(300); await __wait(500);`);
      await shot(c, path.join(OUT, 'hq-group.png'), PREP + `const f = document.querySelector('.hq-form'); const r = f.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 140, width: innerWidth, height: Math.min(3000, r.height + 150) };`);
      console.log('✓ hq-group');
      await run(c, PREP + `document.querySelector('.hq-form [name=positions]').value = '打掃'; document.querySelector('.hq-form [type=submit]').click(); for (let i = 0; i < 40 && !/已送出給各區/.test(document.body.innerText); i++) await __wait(300);
        const d = await Api.admin('hqList', {}); const xs = d.campaigns.filter((x) => x.title === '測試大掃除'); if (xs.length !== 2 || xs.some((x) => x.status !== 'sent' || x.positions[0].name !== '打掃')) throw new Error('INFO sent=' + JSON.stringify(xs.map((x) => [x.status, x.regions, x.positions])));`);
    }
  }
  if (want('hq-list')) {
    await run(c, PREP + `location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-card'); i++) await __wait(300); await __wait(300);`);
    await shot(c, path.join(OUT, 'hq-list.png'), PREP + `const b = document.querySelector('.admin-head'); b.scrollIntoView(); const r = b.getBoundingClientRect(); const e = document.querySelector('[data-body]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(1400, e.bottom - r.top + 12) };`);
    console.log('✓ hq-list');
  }
}

/** 上下溝通（2026/11/23）：分壇公告 → 教捨區看公告、回覆分壇申請調名額 → 分壇回覆、一鍵提醒 → 教捨區看到回覆 */
async function talkShots(c, want) {
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5000); };
  const login = PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`;
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/hqnotice'; for (let i = 0; i < 30 && !document.querySelector('[data-new]'); i++) await __wait(300); document.querySelector('[data-new]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box form'); i++) await __wait(300);
    const f = document.querySelector('.modal-box form'); f.elements.title.value = '測試：12 月分壇會議改到週六'; f.elements.body.value = '原本 12/13（日）的分壇會議改到 12/12（六）下午 2 點，地點不變。\\n請各區組長準時參加 🙏'; await __wait(300);`);
  if (want('hq-notice')) { await shot(c, path.join(OUT, 'hq-notice.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-notice'); }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !document.querySelector('.hq-notice'); i++) await __wait(300); if (!document.querySelector('.hq-notice')) throw new Error('INFO 沒有公告');`);
  await go(BASE + 'she/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('.hq-notice-box'); i++) await __wait(300); if (!document.querySelector('[data-read]')) throw new Error('INFO 沒有公告'); await __wait(300);`);
  if (want('hq-inbox-notice')) { await shot(c, path.join(OUT, 'hq-inbox-notice.png'), PREP + `const a = document.querySelector('.admin-tabs').getBoundingClientRect(); const b = document.querySelector('.hq-notice-box').getBoundingClientRect(); return { x: 0, y: a.top + scrollY - 6, width: innerWidth, height: b.bottom - a.top + 16 };`); console.log('✓ hq-inbox-notice'); }
  await run(c, PREP + `document.querySelector('[data-read]').click(); for (let i = 0; i < 30 && document.querySelector('[data-read]'); i++) await __wait(300);
    const sec = [...document.querySelectorAll('.hq-inbox-group')].find((x) => /測試志工輪值/.test(x.textContent)); sec.querySelector('[data-reply]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box [name=quotaAsk]'); i++) await __wait(300);
    const f = document.querySelector('.modal-box form'); f.elements.quotaAsk.value = '1'; f.elements.text.value = '本區那幾天都有法會，人手不夠，每次只能派 1 位'; await __wait(300);`);
  if (want('hq-reply')) { await shot(c, path.join(OUT, 'hq-reply.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-reply'); }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !/已送給分壇/.test(document.body.innerText); i++) await __wait(300); if (!/已送給分壇/.test(document.body.innerText)) throw new Error('INFO ' + document.querySelector('.modal-box').innerText);`);
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-replies'); i++) await __wait(300); if (!document.querySelector('.hq-replies')) throw new Error('INFO 沒有回覆'); await __wait(300);`);
  if (want('hq-replies')) { await shot(c, path.join(OUT, 'hq-replies.png'), PREP + `return __box('.hq-replies', 6);`); console.log('✓ hq-replies'); }
  await run(c, PREP + `document.querySelector('[data-answer]').click(); for (let i = 0; i < 30 && !document.querySelector('[data-answer-text]'); i++) await __wait(300); document.querySelector('[data-answer-text]').value = '好的，辛苦了 🙏'; await __wait(300);`);
  if (want('hq-answer')) { await shot(c, path.join(OUT, 'hq-answer.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-answer'); }
  await run(c, PREP + `document.querySelector('.modal-box [data-ok]').click(); for (let i = 0; i < 30 && document.querySelector('.hq-replies'); i++) await __wait(300); if (document.querySelector('.hq-replies')) throw new Error('INFO 回覆沒送出');
    const card = [...document.querySelectorAll('.hq-card')].find((x) => /測試志工輪值/.test(x.textContent) && /整組總覽/.test(x.textContent)); card.click(); for (let i = 0; i < 40 && !document.querySelector('[data-hqremind]'); i++) await __wait(300);
    document.querySelector('[data-hqremind]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box [data-ok]'); i++) await __wait(300); document.querySelector('.modal-box [data-ok]').click();
    for (let i = 0; i < 40 && !/已通知|不用通知/.test((document.querySelector('.modal-box') || {}).innerText || ''); i++) await __wait(300); await __wait(300);`);
  if (want('hq-remind')) { await shot(c, path.join(OUT, 'hq-remind.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-remind'); }
  if (want('hq-notices')) {
    await run(c, PREP + `document.querySelector('.modal-box [data-close]').click(); await __wait(300); location.hash = '#/admin/hqnotice'; for (let i = 0; i < 30 && !document.querySelector('.hq-notice'); i++) await __wait(300); await __wait(300);`);
    await shot(c, path.join(OUT, 'hq-notices.png'), PREP + `const b = document.querySelector('[data-body]'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: Math.min(1400, r.height + 12) };`);
    console.log('✓ hq-notices');
  }
  await go(BASE + 'she/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('.hq-reply-line'); i++) await __wait(300); if (!document.querySelector('.hq-reply-line')) throw new Error('INFO 沒有回覆'); await __wait(300);`);
  if (want('hq-inbox-reply')) { await shot(c, path.join(OUT, 'hq-inbox-reply.png'), PREP + `const sec = document.querySelector('.hq-reply-line').closest('section'); return __box(sec, 6);`); console.log('✓ hq-inbox-reply'); }
}

/** 🤝 請別區支援（2026/11/23）：教捨區請別區支援 1 位 → 分壇同意由教全區支援 → 教全區收到 */
async function supportShots(c, want) {
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5000); };
  const login = PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`;
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `const r = await Api.admin('hqSave', { campaign: { title: '測試中秋園遊會支援', category: '勤務', start: '2027-09-12', startTime: '08:00', endTime: '12:00', location: '測試地點', positions: [{ name: '支援' }], quotaMode: 'assigned', quotas: { she: 3 }, regions: ['she'] } }); if (!r.campaign) throw new Error('INFO no campaign');`);
  await go(BASE + 'she/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('[data-reply]'); i++) await __wait(300);
    const sec = [...document.querySelectorAll('.hq-inbox-group')].find((x) => /測試中秋園遊會支援/.test(x.textContent)); sec.querySelector('[data-reply]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box [name=supportN]'); i++) await __wait(300);
    const f = document.querySelector('.modal-box form'); f.elements.supportN.value = '1'; f.elements.supportTo.value = 'main'; f.elements.text.value = '本區那天有法會，人手不夠'; f.querySelector('.hq-support-ask').scrollIntoView({ block: 'center' }); await __wait(300);`);
  if (want('hq-support-ask')) { await shot(c, path.join(OUT, 'hq-support-ask.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-support-ask'); }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !/已送給分壇/.test(document.body.innerText); i++) await __wait(300); if (!/已送給分壇/.test(document.body.innerText)) throw new Error('INFO ' + document.querySelector('.modal-box').innerText.slice(0, 200));`);
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-replies'); i++) await __wait(300);
    const b = [...document.querySelectorAll('.hq-reply')].find((x) => /請別區支援/.test(x.textContent)).querySelector('[data-answer]'); b.click(); for (let i = 0; i < 30 && !document.querySelector('[data-support-to]'); i++) await __wait(300); document.querySelector('[data-answer-text]').value = '好，請教全區幫忙 🙏'; await __wait(300);`);
  if (want('hq-support-answer')) { await shot(c, path.join(OUT, 'hq-support-answer.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-support-answer'); }
  await run(c, PREP + `document.querySelector('.modal-box [data-ok]').click(); for (let i = 0; i < 30 && document.querySelector('.modal-box [data-support-to]'); i++) await __wait(300); await __wait(500);
    const d = await Api.admin('hqList', {}); const x = d.campaigns.find((y) => y.title === '測試中秋園遊會支援'); if (!x || x.quotas.main !== 1 || x.quotas.she !== 2) throw new Error('INFO quotas=' + JSON.stringify(x && x.quotas));`);
  await go(BASE + '#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/more'; await __wait(300); location.hash = '#/admin/hqinbox'; for (let i = 0; i < 30 && !document.querySelector('.hq-support-line'); i++) await __wait(300); if (!document.querySelector('.hq-support-line')) throw new Error('INFO 教全區沒有支援提示'); await __wait(300);`);
  if (want('hq-support-in')) { await shot(c, path.join(OUT, 'hq-support-in.png'), PREP + `const sec = document.querySelector('.hq-support-line').closest('section'); return __box(sec, 6);`); console.log('✓ hq-support-in'); }
}

/** ⭐ 固定活動範本、📋 複製成新的分派（2026/11/23） */
async function tplShots(c, want) {
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5000); };
  const login = PREP + `const pw = document.querySelector('#admin-password'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`;
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `await __wait(800); const card = [...document.querySelectorAll('.hq-card')].find((x) => /測試志工輪值/.test(x.textContent) && /整組總覽/.test(x.textContent)); if (!card) throw new Error('INFO 沒有整組卡'); card.click(); for (let i = 0; i < 40 && !document.querySelector('[data-save-tpl]'); i++) await __wait(300);
    document.querySelector('[data-save-tpl]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box [name=name]'); i++) await __wait(300); document.querySelector('.modal-box [name=name]').value = '測試每年志工輪值'; await __wait(300);`);
  if (want('hq-tpl-save')) { await shot(c, path.join(OUT, 'hq-tpl-save.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-tpl-save'); }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 30 && !/已存成範本/.test(document.body.innerText); i++) await __wait(300); if (!/已存成範本/.test(document.body.innerText)) throw new Error('INFO ' + (document.querySelector('.modal-box') || document.body).innerText.slice(0, 200));
    document.querySelector('[data-copy]').click(); for (let i = 0; i < 30 && !document.querySelector('.modal-box [data-list] label'); i++) await __wait(300); document.querySelector('.modal-box input[name=mode][value=lunar]').click(); await __wait(400);`);
  if (want('hq-copy')) { await shot(c, path.join(OUT, 'hq-copy.png'), PREP + `return __box('.modal-box', 4);`); console.log('✓ hq-copy'); }
  await run(c, PREP + `document.querySelector('.modal-box form').requestSubmit(); for (let i = 0; i < 40 && !document.querySelector('.hq-group-dates'); i++) await __wait(300); if (!document.querySelector('.hq-group-dates')) throw new Error('INFO 沒到草稿頁');
    location.hash = '#/admin'; for (let i = 0; i < 30 && !document.querySelector('.hq-tpls'); i++) await __wait(300); document.querySelector('.hq-tpls').open = true; await __wait(300);`);
  if (want('hq-tpls')) { await shot(c, path.join(OUT, 'hq-tpls.png'), PREP + `const a = document.querySelector('.admin-actions'); const r = a.getBoundingClientRect(); const e = document.querySelector('.hq-tpls').getBoundingClientRect(); a.scrollIntoView(); return { x: 0, y: a.getBoundingClientRect().top + scrollY - 8, width: innerWidth, height: e.bottom - r.top + 16 };`); console.log('✓ hq-tpls'); }
  await run(c, PREP + `document.querySelector('.hq-tpl-go').click(); for (let i = 0; i < 30 && !document.querySelector('[data-tpl-pick]'); i++) await __wait(300); const f = document.querySelector('.hq-form'); f.elements.start.value = '2027-04-04'; await __wait(300);`);
  if (want('hq-tpl-form')) { await shot(c, path.join(OUT, 'hq-tpl-form.png'), PREP + `const a = document.querySelector('.hq-tpl-pick'); a.scrollIntoView(); const r = a.getBoundingClientRect(); const e = document.querySelector('.hq-form [name=location]').getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: e.bottom - r.top + 16 };`); console.log('✓ hq-tpl-form'); }
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
    await hqShots(c, only);
    await clashShots(c, only);
  } finally {
    c.close();
    proc.kill();
  }
}

/**
 * 📅 排活動時那天別的地方有什麼（2026/11/24）：教全區勾「讓分壇和其他區看得到」、分壇派給教捨區 → 教捨區新增勤務選那天
 * （測試版只有教捨區、分壇能問別區，所以從教捨區拍）
 */
async function clashShots(c, only) {
  if (only.length && only.indexOf('clash-peek') === -1) return;
  const go = async (url) => { await c.send('Page.navigate', { url }); await sleep(5000); };
  const login = PREP + `const pw = document.querySelector('#admin-password') || document.querySelector('input[type=password]'); if (pw) { pw.value = 'test-pass'; pw.form.requestSubmit(); await __wait(2500); }`;
  const D = '2027-02-14';
  await go(BASE + '#/admin');
  await run(c, login);
  await run(c, PREP + `await Api.admin('adminCreateDuties', { duties: [{ name: '測試教全區新春園遊會', category: '勤務', nature: '活動', mode: '公告型', start: '${D}', end: '${D}', startTime: '10:00', endTime: '16:00', location: '測試區中心', hqShow: true, positions: [] }] });`);
  await go(BASE + 'hq/#/admin');
  await run(c, login);
  await run(c, PREP + `await Api.admin('hqSave', { campaign: { title: '測試分壇新春團拜', category: '道務', start: '${D}', startTime: '09:00', endTime: '11:00', location: '測試分壇', positions: ['參加'], quotaMode: 'none', regions: ['she'] } });`);
  await go(BASE + 'she/#/admin');
  await run(c, login);
  await run(c, PREP + `location.hash = '#/admin/duties/new'; for (let i = 0; i < 30 && !document.querySelector('input[name=start]'); i++) { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('自己填')); if (b) b.click(); await __wait(300); }
    const st = document.querySelector('input[name=start]'); st.value = '${D}'; st.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 30 && document.querySelector('[data-clash-peek]').hidden; i++) await __wait(300);
    if (document.querySelector('[data-clash-peek]').hidden) throw new Error('沒有出現撞期提示');`);
  await shot(c, path.join(OUT, 'clash-peek.png'), PREP + `const fs = document.querySelector('input[name=start]').closest('fieldset'); fs.scrollIntoView({ block: 'center' }); const r = fs.getBoundingClientRect(); const p = document.querySelector('[data-clash-peek]').getBoundingClientRect();
    return { x: 0, y: r.top + scrollY - 6, width: innerWidth, height: p.bottom - r.top + 14 };`);
  console.log('✓ clash-peek');
}

// 給 tools/tutorial-shots.js 共用
module.exports = { launch, client, run, sleep, PREP, SEED, BASE };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
