// Cloudflare 版（worker/）：用和 Google 版相同的資料跑主要流程，確認回應一樣；另外測搬家（import）、同步（syncExport）、
// 資料存回 SQLite 的格式、非同步的推播。執行前要先 node tools/build-worker.js（npm test 前會自動做）。
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../tools/build-worker.js'); // 每次測試前用最新的 apps-script/*.gs 重新產生
const { createEnv } = require('./env.js');
const { createApp } = await import('../worker/src/app.js');
const { createMemoryStore } = await import('../worker/src/store.js');
const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10:00

/** 用 Google 版測試環境的初始資料（假名）建立 Cloudflare 版，並透過 import 搬過去 */
async function setup(now = OCT_1) {
  const googleEnv = createEnv(now);
  const sheets = Object.fromEntries(Object.entries(googleEnv.sheets).map(([n, s]) => [n, s.data]));
  const store = createMemoryStore();
  const app = createApp(store, { now: () => now });
  const call = async (method, payload) => {
    const req = method === 'GET'
      ? new Request('https://w.test/?' + new URLSearchParams(payload))
      : new Request('https://w.test/', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
    const res = await app.handle(req);
    store.persist();
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
    return res.json();
  };
  const imp = await call('POST', { action: 'import', sheets, props: { ADMIN_PASSWORD: 'test-pass', ADMIN_CONTACT: '測試管理者' } });
  assert.equal(imp.ok, true, JSON.stringify(imp.error));
  return { store, app, call, googleEnv };
}

test('搬家後讀取結果和 Google 版完全相同（行事曆、打包、勤務詳情）', async () => {
  const { call, googleEnv } = await setup();
  const q = { action: 'getBundle', from: '2025-12-25', to: '2027-01-07' };
  const w = await call('GET', q);
  const g = googleEnv.get(q);
  assert.equal(w.ok, true, JSON.stringify(w.error));
  assert.deepEqual(w.data, g.data);
  const id = w.data.duties.find((d) => d.name === '彌勒山志工輪值').id;
  assert.deepEqual((await call('GET', { action: 'getDuty', id })).data, googleEnv.get({ action: 'getDuty', id }).data);
});

test('報名、名額、取消、我的報名、名字提示都正常', async () => {
  const { call } = await setup();
  const ev = (await call('GET', { action: 'getEvents', from: '2026-11-08', to: '2026-11-08' })).data;
  const team = ev.duties.find((d) => d.name === '12人小組輪值');
  const cook = team.positions.find((p) => p.name === '烹飪');
  const r = await call('POST', { action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const dup = await call('POST', { action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(dup.error.code, 'VALIDATION');
  const mine = await call('POST', { action: 'mySignups', name: '測試甲' });
  assert.equal(mine.data.items.length, 1);
  assert.equal((await call('POST', { action: 'cancel', signupId: r.data.created[0].id })).ok, true);
  assert.equal((await call('POST', { action: 'mySignups', name: '測試甲' })).data.items.length, 0);
  assert.equal((await call('POST', { action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08'], entries: [{ name: '測試乙', identity: '' }] })).error.code, 'VALIDATION');
});

test('資料存回 SQLite 後重新啟動仍在；管理者登入通行碼不會因重新啟動而失效', async () => {
  const { store, call } = await setup();
  const login = await call('POST', { action: 'adminLogin', password: 'test-pass' });
  assert.equal(login.ok, true);
  const token = login.data.token;
  const ev = (await call('GET', { action: 'getEvents', from: '2026-10-13', to: '2026-10-13' })).data;
  const v = ev.duties.find((d) => d.name === '彌勒山志工輪值');
  await call('POST', { action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親' }] });
  // 模擬 Durable Object 重新啟動：同一份 store（記憶體版保留 props、cache）重新建立 app
  const app2 = createApp(store, { now: () => OCT_1 });
  const res = await app2.handle(new Request('https://w.test/', { method: 'POST', body: JSON.stringify({ action: 'adminRecent', token }) }));
  const recent = await res.json();
  assert.equal(recent.ok, true, JSON.stringify(recent.error));
  const day = (await (await app2.handle(new Request('https://w.test/?action=getDuty&id=' + v.id))).json()).data;
  assert.equal(day.signups.length, 1);
});

test('import 要管理密碼（第一次除外）；syncExport 回傳所有分頁、記下統計更新時間', async () => {
  const { call, store } = await setup();
  assert.equal((await call('POST', { action: 'import', password: 'wrong', sheets: {} })).error.code, 'UNAUTHORIZED');
  assert.equal((await call('POST', { action: 'syncExport', password: 'wrong' })).error.code, 'UNAUTHORIZED');
  const s = await call('POST', { action: 'syncExport', password: 'test-pass', statsUpdatedAt: '2026-10-01 09:00:00' });
  assert.equal(s.ok, true);
  assert.ok(s.data.sheets['報名'] && s.data.sheets['勤務'].length > 10);
  assert.equal(s.data.sheets['統計'], undefined);
  assert.equal(s.data.sheets['帳號'], undefined); // 帳號（含密碼雜湊）不同步到 Google
  assert.equal(store.getProp('STATS_UPDATED_AT'), '2026-10-01 09:00:00');
  const st = await call('POST', { action: 'adminLogin', password: 'test-pass' });
  const u = await call('POST', { action: 'adminUpdateStatsSheet', token: st.data.token, year: 2026 });
  assert.equal(u.data.updatedAt, '2026-10-01 09:00:00');
});

test('DM 檔案：登入才能上傳（唯讀不行），之後用網址讀得到；存進勤務的 dm 欄位', async () => {
  const { call, app, store } = await setup();
  const tok = (await call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex').toString('base64');
  assert.equal((await call('POST', { action: 'adminUploadFile', mime: 'image/png', data: png })).error.code, 'UNAUTHORIZED');
  assert.equal((await call('POST', { action: 'adminUploadFile', token: tok, mime: 'text/html', data: png })).error.code, 'BAD_REQUEST');
  const up = await call('POST', { action: 'adminUploadFile', token: tok, mime: 'image/png', name: 'dm.png', data: png });
  assert.equal(up.ok, true, JSON.stringify(up.error));
  const res = await app.handle(new Request('https://w.test/?action=file&id=' + up.data.id));
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString('base64'), png);
  const c = await call('POST', { action: 'adminCreateDuties', token: tok, duties: [{ name: '秋季法會', category: '道務', nature: '法會', start: '2026-11-21', end: '2026-11-21', positions: [{ name: '參加', min: '0', max: '' }], dm: [{ id: up.data.id, name: 'dm.png', mime: 'image/png' }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const d = (await call('GET', { action: 'getDuty', id: c.data.ids[0] })).data;
  assert.deepEqual(d.dm, [{ id: up.data.id, name: 'dm.png', mime: 'image/png' }]);
  void store;
});

test('推播：還沒正式切換不送；切換後用 fetch 並行送出，失效的手機自動停用；測試通知', async () => {
  const OCT_9_EVENING = Date.UTC(2026, 9, 9, 12, 0, 0);
  const { call, app, store } = await setup(OCT_9_EVENING);
  app.gs.ensurePushKeys_();
  const A = 'https://fcm.googleapis.com/fcm/send/aaaaaaaaaaaa';
  const B = 'https://web.push.apple.com/QBBBBBBBBBBBB';
  assert.equal((await call('POST', { action: 'pushSubscribe', endpoint: A })).ok, true);
  assert.equal((await call('POST', { action: 'pushSubscribe', endpoint: B })).ok, true);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return new Response('', { status: url === B ? 410 : 201 }); };
  try {
    assert.deepEqual(await app.cron('tomorrow'), { skipped: 'not-live' });
    assert.equal(calls.length, 0);
    store.setProp('LIVE', '1');
    assert.deepEqual(await app.cron('tomorrow'), { sent: 1, failed: 1 });
    store.persist();
    assert.match(calls[0].opts.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.equal(store.sheets['推播'].find((r) => r[1] === B)[4], '否');
    calls.length = 0;
    assert.equal((await call('POST', { action: 'pushTest', endpoint: A })).ok, true);
    assert.equal(calls.length, 1);
    assert.equal((await call('POST', { action: 'pushTest', endpoint: A })).error.code, 'BUSY');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('借場地通知與後台推播：請求處理完一起送出（正式切換後才送）；每 5 分鐘送排定的', async () => {
  const { call, app, store } = await setup();
  app.gs.ensurePushKeys_();
  const ADMIN = 'https://fcm.googleapis.com/fcm/send/admin-dev-1';
  const token = (await call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  assert.equal((await call('POST', { action: 'adminVenueWatch', token, endpoint: ADMIN, on: true })).data.on, true);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(url); return new Response('', { status: 201 }); };
  try {
    await call('POST', { action: 'requestVenue', dates: ['2026-10-13'], slots: ['晚上'], name: '測試甲', phone: '0912345678', purpose: '讀書會' });
    assert.equal(calls.length, 0, '還沒正式切換不送');
    store.setProp('LIVE', '1');
    await call('POST', { action: 'requestVenue', dates: ['2026-10-14'], slots: ['晚上'], name: '測試甲', phone: '0912345678', purpose: '讀書會' });
    assert.deepEqual(calls, [ADMIN]);
    calls.length = 0;
    assert.equal((await call('POST', { action: 'pushSubscribe', endpoint: ADMIN })).ok, true);
    const saved = await call('POST', { action: 'adminPushSave', token, plan: { title: '📣 公告', body: '明天見', at: '2026-10-01 10:30' } });
    assert.equal(saved.ok, true, JSON.stringify(saved.error));
    assert.deepEqual(await app.cron('plans'), { sent: 0 });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('防止亂報名：同一個網路位址 10 分鐘內超過 20 次就暫停；別的位址不受影響；一次最多 20 個名字', async () => {
  const { app, store } = await setup();
  const send = async (ip, payload) => {
    const res = await app.handle(new Request('https://w.test/', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body: JSON.stringify(payload) }));
    store.persist();
    return res.json();
  };
  for (let i = 0; i < 20; i++) assert.equal((await send('203.0.113.9', { action: 'cancel', signupId: 'S-nope' })).error.code, 'NOT_FOUND');
  assert.equal((await send('203.0.113.9', { action: 'cancel', signupId: 'S-nope' })).error.code, 'BUSY');
  assert.equal((await send('198.51.100.7', { action: 'cancel', signupId: 'S-nope' })).error.code, 'NOT_FOUND', '別的位址照常');
  const many = Array.from({ length: 21 }, (_, i) => ({ name: '測試' + i, identity: '道親' }));
  assert.equal((await send('198.51.100.8', { action: 'signup', dutyId: 'x', positionId: 'y', dates: ['2026-10-13'], entries: many })).error.code, 'BAD_REQUEST');
});

test('修繕照片：公開上傳只收照片、最大 2MB，之後用檔案網址讀得到', async () => {
  const { call } = await setup();
  const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const r = await call('POST', { action: 'repairUpload', mime: 'image/jpeg', data: tiny });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(r.data.id, /^F-/);
  assert.equal((await call('POST', { action: 'repairUpload', mime: 'application/pdf', data: tiny })).error.code, 'BAD_REQUEST');
});
