// 🛠 回報網站問題（2026/11/26）：各區回報／轉意見回饋 → 分壇「🛠 各區回報」→ 分壇回覆送回那一區；截圖。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');

require('../tools/build-worker.js');

async function setup() {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const now = Date.UTC(2026, 10, 26, 2, 0, 0);
  const regions = {};
  const opts = {
    now: () => now,
    cross: async (r, method, payload) => { const x = regions[r]; try { return await x.app.hqRpc(r, method, payload); } finally { x.store.persist(); } },
    openRegions: async () => regions.main.app.openRegions()
  };
  const make = (code, props) => {
    const store = createMemoryStore();
    const app = createApp(store, opts);
    Object.entries(props || {}).forEach(([k, v]) => store.setProp(k, v));
    store.setProp('ADMIN_PASSWORD', 'test-pass');
    store.setProp('NEWCOMER_INFO', '0');
    const call = async (payload) => {
      const res = await app.handle(new Request('https://w.test/', { method: 'POST', headers: { 'X-Region': code }, body: JSON.stringify(payload) }));
      store.persist();
      return res.json();
    };
    let token = '';
    const admin = async (action, body) => {
      if (!token) token = (await call({ action: 'adminLogin', password: 'test-pass' })).data.token;
      return call(Object.assign({ action, token }, body || {}));
    };
    return (regions[code] = { store, app, call, admin });
  };
  make('main', { LIVE: '1', OPEN_REGIONS: JSON.stringify(['she', 'hq']) });
  make('she', { REGION_OPEN: '1', LIVE: '1' });
  make('hq', { REGION_OPEN: '1', LIVE: '1' });
  return regions;
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f00000000049454e44ae426082', 'hex').toString('base64');

test('各區直接回報（含截圖）→ 分壇看到 → 回覆送回那一區', async () => {
  const R = await setup();
  const shot = await R.she.admin('adminReportShot', { mime: 'image/png', data: PNG });
  assert.equal(shot.ok, true, JSON.stringify(shot.error));
  assert.equal((await R.she.admin('adminSiteReport', { text: ' ' })).error.code, 'VALIDATION');
  let r = await R.she.admin('adminSiteReport', { text: '報名頁按了沒反應', page: '#/duty/x', device: 'iPhone Safari', version: '20261126a', shots: [shot.data.id, 'bad'] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  // 這一區看得到自己回報的
  let mine = (await R.she.admin('adminSiteReportList')).data.items;
  assert.deepEqual([mine.length, mine[0].status, mine[0].shots], [1, '新的', [shot.data.id]]);
  // 分壇看得到，知道是哪一區
  const list = (await R.hq.admin('hqReportList')).data.items;
  assert.deepEqual([list.length, list[0].region, list[0].regionName, list[0].device, list[0].shots.length], [1, 'she', '教捨區', 'iPhone Safari', 1]);
  // 各區不能看分壇的清單；分壇不能用各區的回報
  assert.equal((await R.she.admin('hqReportList')).error.code, 'FORBIDDEN');
  assert.equal((await R.hq.admin('adminSiteReport', { text: '測試一下' })).error.code, 'FORBIDDEN');
  // 分壇回覆
  r = await R.hq.admin('hqReportSet', { region: 'she', id: list[0].id, status: '修好了', reply: '已經修好，請重新打開網頁' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.sent, true);
  mine = (await R.she.admin('adminSiteReportList')).data.items;
  assert.deepEqual([mine[0].status, mine[0].reply], ['修好了', '已經修好，請重新打開網頁']);
  // 截圖從那一區拿得到
  const res = await R.she.app.handle(new Request('https://w.test/?action=file&id=' + shot.data.id, { headers: { 'X-Region': 'she' } }));
  assert.equal(res.headers.get('Content-Type'), 'image/png');
});

test('家人們的意見回饋（含截圖）→ 總管理者轉給網站負責人；同一則不能轉兩次', async () => {
  const R = await setup();
  const up = await R.she.call({ action: 'feedbackUpload', mime: 'image/png', data: PNG });
  assert.equal(up.ok, true, JSON.stringify(up.error));
  let r = await R.she.call({ action: 'sendFeedback', text: '行事曆打不開', name: '測試甲', shots: [up.data.id] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  let fb = (await R.she.admin('adminFeedbackList')).data.items[0];
  assert.deepEqual(fb.shots, [up.data.id]);
  r = await R.she.admin('adminSiteReport', { fbId: fb.id, note: '好幾位家人都說' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal((await R.she.admin('adminSiteReport', { fbId: fb.id })).error.code, 'VALIDATION');
  fb = (await R.she.admin('adminFeedbackList')).data.items[0];
  assert.deepEqual([fb.status, fb.forwarded.status], ['已讀', '新的']);
  const x = (await R.hq.admin('hqReportList')).data.items[0];
  assert.deepEqual([x.kind, x.text, x.name, x.note, x.shots], ['feedback', '行事曆打不開', '測試甲', '好幾位家人都說', [up.data.id]]);
  assert.equal(Object.keys(x).some((k) => /phone|電話/.test(k)), false);
});

test('唯讀帳號不能回報；類別帳號可以直接回報但不能轉意見回饋', async () => {
  const R = await setup();
  await R.she.admin('adminSaveAccount', { account: { account: 'ro', role: '唯讀', password: 'ro-pass-1234' } });
  await R.she.admin('adminSaveAccount', { account: { account: 'edu', role: '教育', password: 'edu-pass-1234' } });
  const login = async (a, p) => (await R.she.call({ action: 'adminLogin', account: a, password: p })).data.token;
  const ro = await login('ro', 'ro-pass-1234');
  const edu = await login('edu', 'edu-pass-1234');
  assert.equal((await R.she.call({ action: 'adminSiteReport', token: ro, text: '測試一下' })).error.code, 'FORBIDDEN');
  assert.equal((await R.she.call({ action: 'adminSiteReportList', token: ro })).error.code, 'FORBIDDEN');
  assert.equal((await R.she.call({ action: 'adminSiteReport', token: edu, text: '統計頁數字怪怪的' })).ok, true);
  await R.she.call({ action: 'sendFeedback', text: '字太小' });
  const fb = (await R.she.admin('adminFeedbackList')).data.items[0];
  assert.equal((await R.she.call({ action: 'adminSiteReport', token: edu, fbId: fb.id })).error.code, 'FORBIDDEN');
});
