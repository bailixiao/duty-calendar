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

test('從檔案匯入：存成草稿（各區看不到）→ 補資料送出才收到；AI 讀檔用教全區的金鑰', async () => {
  const R = await setup();
  R.main.store.setProp('GEMINI_API_KEY', 'main-key');
  // 草稿：一次存好幾筆，不送
  let r = await R.hq.admin('hqSaveDrafts', { items: [
    { title: '測試中秋聯誼', category: '勤務', start: '2026-12-25', regions: ['she'], source: '測試.pdf 第 1 頁' },
    { title: '測試法會', category: '道務', start: '2027-01-03', regions: [] }
  ] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.saved, 2);
  let list = (await R.hq.admin('hqList')).data.campaigns;
  assert.deepEqual(list.map((c) => c.status).sort(), ['draft', 'draft']);
  assert.equal((await R.she.admin('adminHqInbox')).data.items.length, 0, '草稿各區看不到');
  const draft = list.find((c) => c.title === '測試中秋聯誼');
  const sum = (await R.hq.admin('hqSummary', { id: draft.id })).data;
  assert.equal(sum.regions[0].status, 'draft');
  // 存草稿再改還是草稿；送出（draft 沒帶）才送
  r = await R.hq.admin('hqSave', { campaign: Object.assign({}, draft, { description: '補上說明' }), draft: true });
  assert.equal(r.data.campaign.status, 'draft');
  assert.equal((await R.she.admin('adminHqInbox')).data.items.length, 0);
  r = await R.hq.admin('hqSave', { campaign: Object.assign({}, draft, { description: '補上說明' }) });
  assert.equal(r.data.campaign.status, 'sent');
  assert.equal(r.data.campaign.source, '測試.pdf 第 1 頁', '來源留著');
  assert.equal((await R.she.admin('adminHqInbox')).data.items.length, 1, '送出後各區收到');
  // 送出的不能再變回草稿
  r = await R.hq.admin('hqSave', { campaign: r.data.campaign, draft: true });
  assert.equal(r.data.campaign.status, 'sent');
  // 沒選區的草稿要送出會擋
  const law = list.find((c) => c.title === '測試法會');
  assert.equal((await R.hq.admin('hqSave', { campaign: law })).error.code, 'VALIDATION');

  // AI 讀檔：分壇沒有金鑰，用教全區的
  const realFetch = global.fetch;
  let usedKey = '';
  global.fetch = async (url, opt) => {
    usedKey = opt && opt.headers && opt.headers['x-goog-api-key'];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ title: '測試大典', category: '道務', start: '2027-02-01', startTime: '09:00' }, { notTitle: 1 }]) }] } }] }), { status: 200 });
  };
  try {
    r = await R.hq.admin('hqImportAi', { text: '2/1 測試大典 9:00', part: '測試.docx' });
  } finally { global.fetch = realFetch; }
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(usedKey, 'main-key');
  assert.deepEqual(r.data.items.map((x) => x.title), ['測試大典']);
  assert.equal((await R.she.admin('hqImportAi', { text: 'x' })).error.code, 'FORBIDDEN', '只有分壇能用');
});

test('同名草稿一次送出（hqSaveMany）：每一區一次收好幾筆；有一筆不對就都不送；整組刪草稿', async () => {
  const R = await setup();
  let r = await R.hq.admin('hqSaveDrafts', { items: ['2026-12-20', '2026-12-27', '2027-01-03'].map((d) => ({ title: '測試輪值', category: '勤務', start: d, regions: ['she'] })) });
  assert.equal(r.data.saved, 3);
  const ds = (await R.hq.admin('hqList')).data.campaigns;
  // 有一筆沒有區 → 都不送
  r = await R.hq.admin('hqSaveMany', { items: ds.map((c, i) => Object.assign({}, c, { regions: i ? ['she'] : [] })) });
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal((await R.she.admin('adminHqInbox')).data.items.length, 0);
  // 送出兩筆、一筆留草稿
  r = await R.hq.admin('hqSaveMany', { items: ds.slice(0, 2).map((c) => Object.assign({}, c, { positions: [{ name: '打掃' }] })) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.sent, 2);
  assert.deepEqual(r.data.campaigns.map((c) => c.delivery.she), ['ok', 'ok']);
  const inbox = (await R.she.admin('adminHqInbox')).data.items;
  assert.equal(inbox.length, 2);
  assert.equal(inbox[0].c.positions[0].name, '打掃');
  const after = (await R.hq.admin('hqList')).data.campaigns;
  assert.equal(after.length, 3);
  assert.equal(after.filter((c) => c.status === 'sent').length, 2);
  // 整組刪草稿：送出的不會被刪
  r = await R.hq.admin('hqDeleteDrafts', { ids: after.map((c) => c.id) });
  assert.equal(r.data.deleted, 1);
  assert.equal((await R.hq.admin('hqList')).data.campaigns.length, 2);
});

test('各區整組放到行事曆（adminHqPublishMany）：補充說明、名額填一次；收回的跳過', async () => {
  const R = await setup();
  let r = await R.hq.admin('hqSaveDrafts', { items: ['2026-12-20', '2026-12-27', '2027-01-03'].map((d) => ({ title: '測試輪值', category: '勤務', start: d, regions: ['she'], quotaMode: 'self' })) });
  const ds = (await R.hq.admin('hqList')).data.campaigns;
  r = await R.hq.admin('hqSaveMany', { items: ds });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const ids = (await R.she.admin('adminHqInbox')).data.items.map((x) => x.id);
  assert.equal(ids.length, 3);
  // 各區自己報名額：沒填就整組擋
  assert.equal((await R.she.admin('adminHqPublishMany', { ids })).error.code, 'VALIDATION');
  // 分壇收回一個
  await R.hq.admin('hqDelete', { id: ids[2] });
  r = await R.she.admin('adminHqPublishMany', { ids, quota: 2, note: '測試集合' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.done, 2);
  assert.equal(r.data.skipped, 1);
  const items = r.data.items.filter((x) => x.status === 'published');
  assert.equal(items.length, 2);
  assert.ok(items.every((x) => x.note === '測試集合' && x.quota === 2 && x.dutyId));
  const ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2027-01-31' }, 'GET')).data.duties;
  assert.equal(ev.filter((d) => d.name === '測試輪值').length, 2);
});

test('整組總覽（hqGroupSummary）：日期 × 各區的狀態、人數，每一區只問一次', async () => {
  const R = await setup();
  await R.hq.admin('hqSaveDrafts', { items: ['2026-12-20', '2026-12-27'].map((d) => ({ title: '測試輪值', category: '勤務', start: d, regions: ['she', 'zhen'] })) });
  const ds = (await R.hq.admin('hqList')).data.campaigns;
  await R.hq.admin('hqSaveMany', { items: ds });
  const ids = (await R.she.admin('adminHqInbox')).data.items.map((x) => x.id).sort();
  await R.she.admin('adminHqPublish', { id: ids[0] });
  const r = await R.hq.admin('hqGroupSummary', { ids });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.campaigns.length, 2);
  assert.deepEqual(r.data.regions.map((x) => x.code).sort(), ['she', 'zhen']);
  assert.equal(r.data.cells[ids[0]].she.status, 'published');
  assert.equal(r.data.cells[ids[1]].she.status, 'new');
  assert.ok(['not-open', 'new'].indexOf(r.data.cells[ids[0]].zhen.status) !== -1);
  assert.equal((await R.she.admin('hqGroupSummary', { ids })).error.code, 'FORBIDDEN', '只有分壇能看');
});
