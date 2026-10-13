// 圖解教學的圖：用電腦上的 Chrome（無畫面模式）打開本機測試版，一步一步操作，
// 在畫面上方加說明列、用紅框圈出要按的地方，存成 img/tutorial/NN.jpg（540 寬）。截圖裡只有假名。
// 執行：先開測試版（tools/dev-server.js --mock），再 node tools/tutorial-shots.js [只拍某幾步的編號⋯]
//   測試版不是 5175 時：SHOT_BASE=http://localhost:埠號/ node tools/tutorial-shots.js
// 手機系統的畫面（LINE、加到主畫面、允許通知：01～06、24～29）拍不到，沿用原本的圖。
const fs = require('fs');
const path = require('path');
const { launch, client, run, sleep, PREP, SEED, BASE } = require('./help-shots.js');
const T = require('../js/tutorial.js');

const OUT = path.join(__dirname, '..', 'img', 'tutorial');
const WIDTH = 390; // 手機畫面寬（輸出 540 寬）

// 在頁面上加說明列和紅框：t() 回傳要圈的元素
const MARK = `
  window.__mark = async (el, n, title, sub) => {
    document.querySelectorAll('.__tut').forEach((x) => x.remove());
    if (!el) throw new Error('找不到要圈的地方：' + title);
    const bar = document.createElement('div');
    bar.className = '__tut';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#9c3b22;color:#fff;padding:14px 16px 12px;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,.25)';
    bar.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:22px;font-weight:800;line-height:1.3"><span style="flex:none;display:inline-grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#fff;color:#9c3b22;font-size:20px">' + n + '</span><span>' + title + '</span></div>' + (sub ? '<div style="margin-top:6px;font-size:15px;line-height:1.5">' + sub + '</div>' : '');
    document.body.appendChild(bar);
    const barH = bar.getBoundingClientRect().height;
    el.scrollIntoView({ block: 'center' });
    await __wait(300);
    let r = el.getBoundingClientRect();
    if (r.top < barH + 16) { window.scrollBy(0, r.top - barH - 24); await __wait(200); r = el.getBoundingClientRect(); }
    const box = document.createElement('div');
    box.className = '__tut';
    box.style.cssText = 'position:fixed;z-index:99998;border:4px solid #e53935;border-radius:14px;pointer-events:none;box-shadow:0 0 0 3px rgba(255,255,255,.7)';
    box.style.left = (r.left - 6) + 'px'; box.style.top = (r.top - 6) + 'px'; box.style.width = (r.width + 12) + 'px'; box.style.height = (r.height + 12) + 'px';
    document.body.appendChild(box);
    const hand = document.createElement('div');
    hand.className = '__tut';
    hand.textContent = '👆';
    hand.style.cssText = 'position:fixed;z-index:99999;font-size:40px;pointer-events:none';
    hand.style.left = Math.min(innerWidth - 54, r.left + r.width / 2 + 10) + 'px';
    hand.style.top = Math.min(innerHeight - 56, r.bottom - 8) + 'px';
    document.body.appendChild(hand);
  };
  window.__find = (sel, text) => [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.includes(text) && e.offsetParent !== null);
  window.__type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
`;

// 示範用的資料（測試版、假名）：好幾天的勤務、可兼任的勤務
const SEED_T = `
  if (window.__tutSeeded) return;
  const tok = (await __p({ action: 'adminLogin', password: 'test-pass' })).data.token;
  await __p({ action: 'adminCreateDuties', token: tok, duties: [
    { name: '中秋活動布置（示範）', start: '2026-10-24', end: '2026-10-26', startTime: '09:00', location: '區中心', positions: [{ name: '布置', min: 2, max: 6 }, { name: '茶水', min: 1, max: 3 }] },
    { name: '長青班勤務（示範）', start: '2026-10-31', startTime: '09:00', location: '區中心', multi: true, totalNeed: 6, leaderTitle: '勤務組長', positions: [{ name: '淨手', min: 1, max: 2 }, { name: '茶水', min: 1, max: 2 }, { name: '收桌椅', min: 2, max: 6 }] }
  ] });
  window.__tutSeeded = true;
`;
const dutyByName = (part) => `(await __g({ action: 'getEvents', from: '2026-10-08', to: '2026-12-31' })).data.duties.find((x) => x.name.includes(${JSON.stringify(part)}))`;

// 每一步：{ n, hash（先到哪一頁）, js（操作）, t（回傳要圈的元素）, sub（說明第二行） }；標題用 js/tutorial.js 的 STEPS
const STEPS = [
  { n: '07', hash: '#/', js: `document.querySelector('[data-view=month]').click(); await __wait(500);`, t: `document.querySelector('[data-view=recent]')`, sub: '會列出最近的勤務，點勤務就能報名' },
  { n: '08', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(800);`, t: `[...document.querySelectorAll('#view-calendar .duty-card.kind-short')][0]`, sub: '點一下就能報名幫忙' },
  { n: '09', hash: '#/', js: `document.querySelector('[data-view=month]').click(); await __wait(800);`, tap: '.fc-daygrid-day[data-date="2026-10-24"]', t: `document.querySelector('#day-panel .duty-card') || document.querySelector('.fc-daygrid-day[data-date="2026-10-24"]')`, sub: '有小圓點的日期就有勤務，點日期再點下面的勤務' },
  { n: '10', hash: null, js: `const d = ${dutyByName('中秋活動布置')}; location.hash = '#/duty/' + encodeURIComponent(d.id); await __wait(2500);`, t: `document.querySelector('[data-positions]')`, sub: '有好幾個項目時，先選一個；灰色＝額滿' },
  { n: '11', hash: null, js: `document.querySelectorAll('[data-positions] input')[0].click(); await __wait(200); __type(document.querySelector('[data-name-input]'), '王'); await __wait(1500);`, t: `document.querySelector('[data-name-input]').closest('fieldset')`, sub: '打一個字就會跳出名字，點一下就加入' },
  { n: '12', hash: null, js: `const s = __find('[data-suggestions] button'); if (s) s.click(); else { __type(document.querySelector('[data-name-input]'), '王小明'); document.querySelector('[data-add]').click(); } await __wait(1200); const id1 = document.querySelector('.name-item input[value="道親"]'); if (id1) id1.click(); await __wait(300);`, t: `document.querySelector('.name-item')`, sub: '名單上已登記的身分會自動帶入；沒有的請選「道親」「壇辦」或「未求道」' },
  { n: '13', hash: null, js: `__type(document.querySelector('[data-name-input]'), '測試乙'); document.querySelector('[data-add]').click(); await __wait(1200); const idb = [...document.querySelectorAll('.name-item')].pop().querySelector('input[value="道親"]'); if (idb) idb.click(); await __wait(300);`, t: `document.querySelector('[data-names]')`, sub: '再輸入下一個名字按「加入」；要報不同項目或日期，按名字下面的按鈕' },
  { n: '14', hash: null, js: `await __wait(200);`, t: `document.querySelector('[data-dates]')`, sub: '好幾天的勤務要自己勾日期，可以勾好幾天' },
  { n: '15', hash: null, js: `document.querySelectorAll('[data-dates] input:not(:disabled)')[0].click(); await __wait(300);`, t: `document.querySelector('[data-submit]')`, sub: '看一下名字、項目、日期，再按確認' },
  { n: '16', hash: null, js: `document.querySelector('[data-submit]').click(); for (let i = 0; i < 20 && !document.querySelector('.notice-success'); i++) { await __wait(500); const e = document.querySelector('[data-error]'); if (e && !e.hidden && e.textContent.trim()) throw new Error('報名沒成功：' + e.textContent.trim()); }`, t: `document.querySelector('.notice-success')`, sub: '名字會出現在報名名單上，可以按「加到手機行事曆」' },
  { n: '17', hash: null, js: `const d = ${dutyByName('長青班勤務')}; location.hash = '#/duty/' + encodeURIComponent(d.id); await __wait(2500); __type(document.querySelector('[data-name-input]'), '測試甲'); document.querySelector('[data-add]').click(); await __wait(1200); const card = document.querySelector('.name-item'); const id = card.querySelector('input[value="道親"]'); if (id) id.click(); await __wait(200); const chips = document.querySelectorAll('.name-item input[data-entry-pos]'); if (chips[0]) chips[0].click(); await __wait(150); if (document.querySelectorAll('.name-item input[data-entry-pos]')[2]) document.querySelectorAll('.name-item input[data-entry-pos]')[2].click(); await __wait(300);`, t: `document.querySelector('.name-item')`, sub: '一個人可以勾好幾項；有組長的勤務，下面可以選誰當組長' },
  { n: '18', hash: null, js: `const d = ${dutyByName('研究班')}; location.hash = '#/duty/' + encodeURIComponent(d.id); await __wait(2500);`, t: `document.querySelector('.signup-form')`, sub: '道務、教育的課程活動，填名字就能報名' },
  { n: '19', hash: null, js: `const d = (await __g({ action: 'getEvents', from: '2026-10-08', to: '2026-12-31' })).data.duties.find((x) => x.mode === '公告型' && x.group); location.hash = '#/duty/' + encodeURIComponent(d.id); await __wait(2500);`, t: `[...document.querySelectorAll('#view-duty .detail-section')].find((s) => s.textContent.includes('本次輪值')) || document.querySelector('#view-duty .detail-info')`, sub: '公告型不用報名，看是哪一組輪值就好' },
  { n: '20', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(600);`, t: `document.querySelector('a.mine-link[href="#/mine"]')`, sub: '要取消、改期或看自己報了什麼，都在這裡' },
  { n: '21', hash: '#/mine', js: `localStorage.removeItem('duty-calendar:mine-name'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(1500); __type(document.querySelector('#view-mine input'), '測'); await __wait(1500);`, t: `document.querySelector('#view-mine .suggestions') && document.querySelector('#view-mine .suggestions').children.length ? document.querySelector('#view-mine .suggestions') : document.querySelector('#view-mine input')`, sub: '打一個字就會跳出名字，點一下就會列出您之後的報名' },
  { n: '22', hash: '#/mine', js: `localStorage.setItem('duty-calendar:mine-name', '測試甲'); location.hash = '#/'; await __wait(200); location.hash = '#/mine'; await __wait(2200);`, t: `document.querySelector('.mine-actions')`, sub: '按「取消」或「改期」；職司表的報名還可以改註記' },
  { n: '23', hash: null, js: `document.querySelector('[data-cancel]').click(); await __wait(800);`, t: `document.querySelector('.modal')`, sub: '確認資料沒錯，按「確定取消報名」才會取消' },
  { n: '30', hash: '#/', js: `document.querySelector('[data-view=recent]').click(); await __wait(600);`, t: `document.querySelector('a.venue-link')`, sub: '借區中心的場地都在這裡申請' },
  { n: '31', hash: '#/venue?date=2026-10-30', js: `await __wait(1500);`, t: `document.querySelector('[data-pick] input[type=date]')`, sub: '最早明天、最多半年內；好幾天的選「多個日期」，可以在月曆上點' },
  { n: '32', hash: null, js: `const c = () => document.querySelectorAll('[data-hour]'); c()[2].click(); await __wait(300); c()[4].click(); await __wait(400);`, t: `document.querySelector('.hour-grid')`, sub: '點開始那格、再點結束那格就選好一段；灰色＝已借出' },
  { n: '33', hash: null, js: `const f = document.querySelector('.venue-form'); f.elements.name.value = '王小明'; f.elements.phone.value = '0900-000000'; f.elements.purpose.value = '讀經班'; f.elements.people.value = '12'; await __wait(200);`, t: `document.querySelector('.venue-form')`, sub: '電話只有管理者看得到；管理者同意後才算借到' },
  { n: '34', hash: null, js: `document.querySelector('[data-submit]').click(); await __wait(3000); const m = document.querySelector('[data-mine]'); m.elements.mname.value = '王小明'; m.requestSubmit(); await __wait(2000);`, t: `document.querySelector('[data-mine-result]')`, sub: '⏳ 審核中、✅ 已借到；要改時間或取消，在這裡申請' }
];

async function main() {
  const only = process.argv.slice(2);
  const { proc, ws } = await launch();
  const c = await client(ws);
  try {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 844, deviceScaleFactor: 540 / WIDTH, mobile: true });
    await c.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
    await c.send('Page.navigate', { url: BASE });
    await sleep(4500);
    await run(c, PREP + `localStorage.setItem('duty-calendar:push-ask-later', String(Date.now())); localStorage.setItem('duty-calendar:cat', '全部');`);
    await run(c, PREP + SEED);
    await run(c, PREP + SEED_T);
    await c.send('Page.reload');
    await sleep(4500);
    for (const s of STEPS) {
      if (only.length && only.indexOf(s.n) === -1) continue;
      const title = Array.isArray(T.STEPS[s.n]) ? T.STEPS[s.n][1] : T.STEPS[s.n];
      await run(c, PREP + MARK + `document.querySelectorAll('.__tut').forEach((x) => x.remove()); for (let i = 0; i < 3; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));`);
      await run(c, PREP + MARK + (s.hash ? `location.hash = '#/__'; await __wait(100); location.hash = ${JSON.stringify(s.hash)}; await __wait(1500); window.scrollTo(0, 0);` : '') + s.js);
      if (s.tap) {
        const p = await run(c, PREP + `const el = document.querySelector(${JSON.stringify(s.tap)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await sleep(900);
      }
      await run(c, PREP + MARK + `await __mark(${s.t}, ${Number(s.n)}, ${JSON.stringify(title)}, ${JSON.stringify(s.sub || '')});`);
      await sleep(300);
      const res = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 78 });
      fs.writeFileSync(path.join(OUT, s.n + '.jpg'), Buffer.from(res.data, 'base64'));
      console.log('✓ ' + s.n + ' ' + title);
    }
    await run(c, PREP + `document.querySelectorAll('.__tut').forEach((x) => x.remove());`);
  } finally {
    c.close();
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
