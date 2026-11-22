// 宏教分壇分派（2026/11/22）：分壇開分派 → 各區收件匣 → 組長放到行事曆／不參加 → 家人報名 → 分壇總表。
const test = require('node:test');
const assert = require('node:assert/strict');

require('../tools/build-worker.js');

async function setup() {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const now = Date.UTC(2026, 10, 22, 2, 0, 0);
  const regions = {};
  const opts = {
    now: () => now,
    cross: async (r, method, payload) => { const x = regions[r]; try { return x.app.hqRpc(r, method, payload); } finally { x.store.persist(); } },
    openRegions: async () => regions.main.app.openRegions()
  };
  const make = (code, props) => {
    const store = createMemoryStore();
    const app = createApp(store, opts);
    Object.entries(props || {}).forEach(([k, v]) => store.setProp(k, v));
    store.setProp('ADMIN_PASSWORD', 'test-pass');
    const call = async (payload, method) => {
      const headers = { 'X-Region': code };
      const req = method === 'GET'
        ? new Request('https://w.test/?' + new URLSearchParams(payload), { headers })
        : new Request('https://w.test/', { method: 'POST', headers, body: JSON.stringify(payload) });
      const res = await app.handle(req);
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

const CAMPAIGN = {
  title: '測試分壇大典', category: '勤務', start: '2026-12-20', startTime: '08:00', endTime: '12:00', location: '測試地點',
  description: '請各區派人支援', positions: ['接待'], quotaMode: 'assigned', quotas: { main: 3, she: 2 }, regions: ['main', 'she', 'ding']
};

test('分壇開分派 → 各區收件匣 → 放到行事曆 → 報名 → 分壇總表；分壇改了跟著變；不參加；收回', async () => {
  const R = await setup();
  // 只有分壇能開分派
  assert.equal((await R.she.admin('hqSave', { campaign: CAMPAIGN })).error.code, 'FORBIDDEN');
  let r = await R.hq.admin('hqSave', { campaign: CAMPAIGN });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const id = r.data.campaign.id;
  assert.deepEqual(r.data.campaign.delivery, { main: 'ok', she: 'ok', ding: 'not-open' });

  // 教捨區：收件匣有一件待處理，行事曆上還沒有
  let inbox = (await R.she.admin('adminHqInbox')).data;
  assert.equal(inbox.pending, 1);
  assert.equal(inbox.items[0].quota, 2);
  let ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties;
  assert.equal(ev.length, 0, '組長還沒放上去，行事曆不會出現');

  // 放到本區行事曆（補充說明）
  r = await R.she.admin('adminHqPublish', { id, note: '本區 7:30 區中心集合' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].fromHq, true);
  assert.equal(ev[0].positions[0].max, 2, '分壇分配的名額＝最多人數');
  const duty = (await R.she.call({ action: 'getDuty', id: ev[0].id }, 'GET')).data;
  assert.match(duty.description, /本區 7:30 區中心集合/);

  // 一般的修改、刪除擋下來
  assert.equal((await R.she.admin('adminDeleteDuty', { id: ev[0].id })).error.code, 'FORBIDDEN');

  // 家人報名
  r = await R.she.call({ action: 'signup', dutyId: ev[0].id, positionId: ev[0].positions[0].id, dates: ['2026-12-20'], entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '壇辦' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));

  // 分壇改時間 → 已經放上去的跟著改，收件匣標「分壇有更新」
  r = await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { id, startTime: '09:00' }) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties;
  assert.equal(ev[0].startTime, '09:00');
  inbox = (await R.she.admin('adminHqInbox')).data;
  assert.equal(inbox.items[0].updated, true);

  // 已經有人報名，不能改成不參加
  assert.equal((await R.she.admin('adminHqDecline', { id, reason: '人手不足' })).error.code, 'FORBIDDEN');
  // 教全區不參加（要寫原因）
  assert.equal((await R.main.admin('adminHqDecline', { id, reason: '' })).error.code, 'VALIDATION');
  assert.equal((await R.main.admin('adminHqDecline', { id, reason: '同一天本區有法會' })).ok, true);

  // 分壇總表
  const sum = (await R.hq.admin('hqSummary', { id })).data;
  const by = Object.fromEntries(sum.regions.map((x) => [x.code, x]));
  assert.equal(by.she.status, 'published');
  assert.equal(by.she.count, 2);
  assert.deepEqual(by.she.people.map((p) => p.name).sort(), ['測試乙', '測試甲']);
  assert.ok(by.she.people.every((p) => !('phone' in p)), '不含電話');
  assert.equal(by.main.status, 'declined');
  assert.equal(by.main.declineReason, '同一天本區有法會');
  assert.equal(by.ding.status, 'not-open');

  // 類別帳號：只看自己那一類（道務帳號看不到總務的分派）
  assert.equal((await R.she.admin('adminSaveAccount', { account: { account: '測試道務', role: '道務', password: 'dao-pass-1234' } })).ok, true);
  const daoTok = (await R.she.call({ action: 'adminLogin', account: '測試道務', password: 'dao-pass-1234' })).data;
  assert.ok(daoTok && daoTok.token, '道務帳號登入');
  assert.equal((await R.she.call({ action: 'adminHqInbox', token: daoTok.token })).data.items.length, 0);

  // 分壇刪掉分派：各區收件匣標「已收回」，已經放上去的勤務留著
  assert.equal((await R.hq.admin('hqDelete', { id })).ok, true);
  inbox = (await R.she.admin('adminHqInbox')).data;
  assert.equal(inbox.items[0].status, 'withdrawn');
  ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties;
  assert.equal(ev.length, 1);
});

test('名額由各區自己報：放上去時一定要填', async () => {
  const R = await setup();
  const id = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { quotaMode: 'self', quotas: {}, regions: ['she'] }) })).data.campaign.id;
  assert.equal((await R.she.admin('adminHqPublish', { id })).error.code, 'VALIDATION');
  const r = await R.she.admin('adminHqPublish', { id, quota: 5 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties;
  assert.equal(ev[0].positions[0].max, 5);
});
