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
    cross: async (r, method, payload) => { const x = regions[r]; try { return await x.app.hqRpc(r, method, payload); } finally { x.store.persist(); } },
    openRegions: async () => regions.main.app.openRegions()
  };
  const make = (code, props) => {
    const store = createMemoryStore();
    const app = createApp(store, opts);
    Object.entries(props || {}).forEach(([k, v]) => store.setProp(k, v));
    store.setProp('ADMIN_PASSWORD', 'test-pass');
    store.setProp('NEWCOMER_INFO', '0');
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

test('分壇的總務・勤務／道務／教育帳號只管自己那一類；統計（hqStats）只算看得到的', async () => {
  const R = await setup();
  let r = await R.hq.admin('adminSaveAccount', { account: { account: '測試道務', role: '道務', password: 'test-pass-2' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const tok = (await R.hq.call({ action: 'adminLogin', account: '測試道務', password: 'test-pass-2' })).data.token;
  const dao = (action, body) => R.hq.call(Object.assign({ action, token: tok }, body || {}));
  // 總管理者開兩類
  await R.hq.admin('hqSave', { campaign: { title: '測試打掃', category: '勤務', start: '2026-12-20', regions: ['she'] } });
  await R.hq.admin('hqSave', { campaign: { title: '測試法會', category: '道務', start: '2026-12-21', regions: ['she'] } });
  // 道務帳號只看到道務
  const mine = (await dao('hqList')).data.campaigns;
  assert.deepEqual(mine.map((c) => c.title), ['測試法會']);
  // 不能開、改、刪勤務的
  assert.equal((await dao('hqSave', { campaign: { title: '測試支援', category: '勤務', start: '2026-12-22', regions: ['she'] } })).error.code, 'FORBIDDEN');
  const work = (await R.hq.admin('hqList')).data.campaigns.find((c) => c.category === '勤務');
  assert.equal((await dao('hqDelete', { id: work.id })).error.code, 'FORBIDDEN');
  assert.equal((await dao('hqSummary', { id: work.id })).error.code, 'FORBIDDEN');
  // 自己那一類可以開
  r = await dao('hqSave', { campaign: { title: '測試研究班', category: '道務', start: '2026-12-23', regions: ['she'] } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  // 統計：教捨區放一個法會
  const law = (await R.she.admin('adminHqInbox')).data.items.find((x) => x.c.title === '測試法會');
  await R.she.admin('adminHqPublish', { id: law.id });
  r = await dao('hqStats', { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.campaigns.map((c) => c.title).sort(), ['測試法會', '測試研究班']);
  assert.equal(r.data.cells[law.id].she.status, 'published');
  assert.equal(r.data.cells[law.id].she.people, undefined, '統計不帶名字');
  r = await R.hq.admin('hqStats', { from: '2026-12-01', to: '2026-12-31' });
  assert.equal(r.data.campaigns.length, 3);
});

test('分壇的唯讀帳號：看得到清單、總表、整組總覽、統計（不含草稿），不能開、改、刪、匯入', async () => {
  const R = await setup();
  await R.hq.admin('adminSaveAccount', { account: { account: '測試唯讀', role: '唯讀', password: 'test-pass-3' } });
  const tok = (await R.hq.call({ action: 'adminLogin', account: '測試唯讀', password: 'test-pass-3' })).data.token;
  const ro = (action, body) => R.hq.call(Object.assign({ action, token: tok }, body || {}));
  const c = (await R.hq.admin('hqSave', { campaign: { title: '測試打掃', category: '勤務', start: '2026-12-20', regions: ['she'] } })).data.campaign;
  await R.hq.admin('hqSaveDrafts', { items: [{ title: '測試草稿', category: '道務', start: '2026-12-21', regions: ['she'] }] });
  const l = await ro('hqList');
  assert.equal(l.ok, true, JSON.stringify(l.error));
  assert.deepEqual(l.data.campaigns.map((x) => x.title), ['測試打掃'], '草稿看不到');
  assert.equal((await ro('hqSummary', { id: c.id })).ok, true);
  assert.equal((await ro('hqGroupSummary', { ids: [c.id] })).ok, true);
  assert.equal((await ro('hqStats', { from: '2026-12-01', to: '2026-12-31' })).data.campaigns.length, 1);
  assert.equal((await ro('hqSave', { campaign: Object.assign({}, c, { title: '改名' }) })).error.code, 'FORBIDDEN');
  assert.equal((await ro('hqDelete', { id: c.id })).error.code, 'FORBIDDEN');
  assert.equal((await ro('hqSaveMany', { items: [c] })).error.code, 'FORBIDDEN');
  assert.equal((await ro('hqImportAi', { text: 'x' })).error.code, 'FORBIDDEN');
});

test('各區回覆分壇、申請調名額（adminHqReply → hqAnswer）：同意就改名額、送回那一區', async () => {
  const R = await setup();
  const id = (await R.hq.admin('hqSave', { campaign: CAMPAIGN })).data.campaign.id;
  assert.equal((await R.she.admin('adminHqReply', { ids: [id] })).error.code, 'VALIDATION', '要寫話或填名額');
  let r = await R.she.admin('adminHqReply', { ids: [id], text: '本區人手不夠', quotaAsk: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.items[0].reply.state, 'pending');
  let c = (await R.hq.admin('hqList')).data.campaigns[0];
  assert.equal(c.replies.she.quotaAsk, 1);
  assert.equal(c.replies.she.text, '本區人手不夠');
  // 分壇改分派內容：回覆留著
  await R.hq.admin('hqSave', { campaign: Object.assign({}, c, { location: '測試地點二' }) });
  c = (await R.hq.admin('hqList')).data.campaigns[0];
  assert.equal(c.replies.she.state, 'pending');
  // 不同意要寫原因
  assert.equal((await R.hq.admin('hqAnswer', { ids: [id], region: 'she', ok: false })).error.code, 'VALIDATION');
  assert.equal((await R.she.admin('hqAnswer', { ids: [id], region: 'she' })).error.code, 'FORBIDDEN');
  r = await R.hq.admin('hqAnswer', { ids: [id], region: 'she', answer: '好的，辛苦了' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.campaigns[0].quotas.she, 1);
  const x = (await R.she.admin('adminHqInbox')).data.items[0];
  assert.equal(x.quota, 1, '那一區的名額跟著改');
  assert.equal(x.reply.state, 'ok');
  assert.equal(x.reply.answer, '好的，辛苦了');
  assert.equal((await R.she.admin('adminHqInbox')).data.answered, 1);
  assert.equal((await R.she.admin('adminHqReplySeen', { ids: [id] })).data.answered, 0);
  // 名額不是分壇分配的，不能申請
  const id2 = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { title: '測試自報', quotaMode: 'self' }) })).data.campaign.id;
  assert.equal((await R.she.admin('adminHqReply', { ids: [id2], quotaAsk: 3 })).error.code, 'VALIDATION');
  assert.equal((await R.she.admin('adminHqReply', { ids: [id2], text: '收到' })).ok, true);
});

test('截止前 3 天自動提醒、分壇一鍵提醒：只提醒還沒放、沒報滿的區', async () => {
  const R = await setup();
  // 測試的今天是 2026-11-22：截止 11/25 → 剛好 3 天前
  const id = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { deadline: '2026-11-25' }) })).data.campaign.id;
  const off = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { title: '測試不提醒', deadline: '2026-11-25', autoRemind: false }) })).data.campaign.id;
  await R.main.admin('adminHqPublish', { id });
  await R.hq.app.cron('today', 'hq');
  const she = (await R.she.admin('adminHqInbox')).data.items;
  assert.equal(she.find((x) => x.id === id).remind.text, '還沒放到行事曆');
  assert.equal(she.find((x) => x.id === off).remind, null, '關掉自動提醒的不提醒');
  assert.equal((await R.main.admin('adminHqInbox')).data.items.find((x) => x.id === id).remind.text, '還差 3 位');
  let c = (await R.hq.admin('hqList')).data.campaigns.find((x) => x.id === id);
  assert.deepEqual(c.reminded.regions.sort(), ['main', 'she']);
  assert.equal(c.reminded.auto, true);
  // 一鍵提醒
  const r = await R.hq.admin('hqRemind', { ids: [off] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.regions.map((x) => x.code), ['main', 'she']);
  assert.equal((await R.she.admin('adminHqInbox')).data.items.find((x) => x.id === off).remind.auto, false);
});

test('分壇公告：發給選的區 → 各區按「知道了」→ 分壇看到已讀；改內容要重新看；刪掉就收回', async () => {
  const R = await setup();
  let r = await R.hq.admin('hqNoticeSave', { notice: { title: '測試公告', body: '下週開會', regions: ['main', 'she', 'ding'] } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const n = r.data.notice;
  assert.deepEqual(n.delivery, { main: 'ok', she: 'ok', ding: 'not-open' });
  let inbox = (await R.she.admin('adminHqInbox')).data;
  assert.equal(inbox.notices.length, 1);
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.pending, 1, '沒讀的公告也算待處理');
  r = await R.she.admin('adminHqNoticeRead', { id: n.id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.unread, 0);
  let l = (await R.hq.admin('hqNoticeList')).data.notices[0];
  assert.ok(l.reads.she && !l.reads.main);
  // 只改區：已讀留著；改內容：重新看
  await R.hq.admin('hqNoticeSave', { notice: Object.assign({}, l, { regions: ['main', 'she'] }) });
  assert.ok((await R.hq.admin('hqNoticeList')).data.notices[0].reads.she);
  await R.hq.admin('hqNoticeSave', { notice: Object.assign({}, l, { body: '改成下下週', regions: ['main', 'she'] }) });
  assert.deepEqual((await R.hq.admin('hqNoticeList')).data.notices[0].reads, {});
  assert.equal((await R.she.admin('adminHqInbox')).data.unread, 1);
  // 類別帳號只能發自己那一類，看得到「全部」的
  await R.hq.admin('adminSaveAccount', { account: { account: '測試教育', role: '教育', password: 'test-pass-4' } });
  const tok = (await R.hq.call({ action: 'adminLogin', account: '測試教育', password: 'test-pass-4' })).data.token;
  const edu = (action, body) => R.hq.call(Object.assign({ action, token: tok }, body || {}));
  assert.equal((await edu('hqNoticeSave', { notice: { title: '測試', regions: ['she'] } })).error.code, 'FORBIDDEN');
  assert.equal((await edu('hqNoticeSave', { notice: { title: '測試教育公告', category: '教育', regions: ['she'] } })).ok, true);
  assert.equal((await edu('hqNoticeList')).data.notices.length, 2);
  assert.equal((await edu('hqNoticeDelete', { id: n.id })).error.code, 'FORBIDDEN');
  // 刪掉：各區收回
  assert.equal((await R.hq.admin('hqNoticeDelete', { id: n.id })).ok, true);
  inbox = (await R.she.admin('adminHqInbox')).data;
  assert.deepEqual(inbox.notices.map((x) => x.title), ['測試教育公告']);
});

test('固定活動範本：存（不含日期）、列出、改、刪；類別帳號只管自己那一類；名稱不能重複', async () => {
  const R = await setup();
  let r = await R.hq.admin('hqTemplateSave', { template: Object.assign({}, CAMPAIGN, { name: '每年測試大典', deadlineDays: 3, end: '2026-12-21' }) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const t = r.data.template;
  assert.equal(t.start, undefined, '範本不存日期');
  assert.equal(t.days, 1, '跨兩天');
  assert.equal(t.deadlineDays, 3);
  assert.deepEqual(t.quotas, { main: 3, she: 2 });
  assert.equal((await R.hq.admin('hqTemplateSave', { template: Object.assign({}, CAMPAIGN, { name: '每年測試大典' }) })).error.code, 'VALIDATION', '名稱重複');
  r = await R.hq.admin('hqTemplateSave', { template: Object.assign({}, t, { location: '測試地點二' }) });
  assert.equal(r.data.template.location, '測試地點二');
  assert.equal((await R.hq.admin('hqTemplateList')).data.templates.length, 1);
  await R.hq.admin('adminSaveAccount', { account: { account: '測試道務', role: '道務', password: 'test-pass-2' } });
  const tok = (await R.hq.call({ action: 'adminLogin', account: '測試道務', password: 'test-pass-2' })).data.token;
  const dao = (action, body) => R.hq.call(Object.assign({ action, token: tok }, body || {}));
  assert.equal((await dao('hqTemplateList')).data.templates.length, 0, '勤務的範本道務看不到');
  assert.equal((await dao('hqTemplateDelete', { id: t.id })).error.code, 'FORBIDDEN');
  assert.equal((await R.she.admin('hqTemplateList')).error.code, 'FORBIDDEN');
  assert.equal((await R.hq.admin('hqTemplateDelete', { id: t.id })).ok, true);
  assert.equal((await R.hq.admin('hqTemplateList')).data.templates.length, 0);
});

test('請別區支援（2026/11/23）：教捨區人不夠，請別區支援 1 位 → 分壇選教全區同意 → 教捨區名額減 1、教全區加 1', async () => {
  const R = await setup();
  const id = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { regions: ['she'], quotas: { she: 3 } }) })).data.campaign.id;
  assert.equal((await R.she.admin('adminHqReply', { ids: [id], supportN: 3 })).error.code, 'VALIDATION', '不能整個名額都移走');
  assert.equal((await R.she.admin('adminHqReply', { ids: [id], supportN: 1, quotaAsk: 2 })).error.code, 'VALIDATION', '兩個選一個');
  let r = await R.she.admin('adminHqReply', { ids: [id], supportN: 1, supportTo: 'main', text: '本區那天有法會' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  let c = (await R.hq.admin('hqList')).data.campaigns[0];
  assert.deepEqual([c.replies.she.supportN, c.replies.she.supportTo], [1, 'main']);
  assert.equal((await R.hq.admin('hqAnswer', { ids: [id], region: 'she', supportTo: 'she' })).error.code, 'VALIDATION', '不能支援自己');
  r = await R.hq.admin('hqAnswer', { ids: [id], region: 'she', supportTo: 'main', answer: '好，請教全區幫忙' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  c = r.data.campaigns[0];
  assert.deepEqual(c.quotas, { she: 2, main: 1 });
  assert.ok(c.regions.indexOf('main') !== -1, '教全區加進送出的區');
  const she = (await R.she.admin('adminHqInbox')).data.items[0];
  assert.equal(she.quota, 2);
  assert.equal(she.reply.state, 'ok');
  assert.equal(she.reply.supportToName, '教全區');
  const main = (await R.main.admin('adminHqInbox')).data.items.find((x) => x.id === id);
  assert.equal(main.quota, 1, '教全區收到分派、名額 1 位');
  assert.equal(main.support.fromName, '教捨區');
});

test('請別區支援：名額不限的分派也可以請；分壇同意後請那一區多派（沒收到的送過去），名額不用動', async () => {
  const R = await setup();
  const id = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { regions: ['she'], quotaMode: 'none', quotas: {} }) })).data.campaign.id;
  assert.equal((await R.she.admin('adminHqReply', { ids: [id], quotaAsk: 2 })).error.code, 'VALIDATION', '不限的不能改名額');
  let r = await R.she.admin('adminHqReply', { ids: [id], supportN: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  r = await R.hq.admin('hqAnswer', { ids: [id], region: 'she', supportTo: 'main' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual([r.data.campaigns[0].quotas, r.data.campaigns[0].regions], [{}, ['she', 'main']]);
  const main = (await R.main.admin('adminHqInbox')).data.items.find((x) => x.id === id);
  assert.equal(main.support.n, 2);
  assert.equal((await R.she.admin('adminHqInbox')).data.items[0].reply.supportToName, '教全區');
});

test('名額分必須、建議（2026/11/23）：建議的放到行事曆不限最多人數、說明寫建議；截止前提醒不算沒報滿', async () => {
  const R = await setup();
  const id = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { regions: ['she', 'main'], quotas: { she: 2, main: 3 }, quotaFirm: false, deadline: '2026-11-25' }) })).data.campaign.id;
  let c = (await R.hq.admin('hqList')).data.campaigns[0];
  assert.equal(c.quotaFirm, false);
  const x = (await R.she.admin('adminHqInbox')).data.items[0];
  assert.equal(x.c.quotaFirm, false);
  await R.she.admin('adminHqPublish', { id });
  const ev = (await R.she.call({ action: 'getEvents', from: '2026-12-01', to: '2026-12-31' }, 'GET')).data.duties[0];
  assert.equal(ev.positions[0].max, null, '建議名額不限制最多人數');
  const duty = (await R.she.call({ action: 'getDuty', id: ev.id }, 'GET')).data;
  assert.match(duty.description, /本區建議名額：2 位/);
  // 截止前提醒：教捨區放了（0／2 不算還差）→ 不提醒；教全區還沒放 → 提醒
  await R.hq.app.cron('today', 'hq');
  assert.equal((await R.she.admin('adminHqInbox')).data.items[0].remind, null);
  assert.equal((await R.main.admin('adminHqInbox')).data.items.find((y) => y.id === id).remind.text, '還沒放到行事曆');
  // 預設是必須
  c = (await R.hq.admin('hqSave', { campaign: Object.assign({}, CAMPAIGN, { title: '測試必須' }) })).data.campaign;
  assert.equal(c.quotaFirm, true);
});

test('撞期提醒（2026/11/23）：各區勾「讓分壇看得到」的活動，分壇排分派時查得到；沒勾的、分壇分派的不算', async () => {
  const R = await setup();
  const mk = (name, hqShow, start, end) => ({ name, category: '道務', nature: '法會', mode: '公告型', start, end: end || start, startTime: '09:00', location: '測試佛堂', hqShow, positions: [] });
  let r = await R.she.admin('adminCreateDuties', { duties: [mk('測試本區法會', true, '2026-12-19', '2026-12-20'), mk('測試一般活動', false, '2026-12-20')] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  await R.hq.admin('hqSave', { campaign: CAMPAIGN }); // 分壇分派放上去的不算
  const id = (await R.she.admin('adminHqInbox')).data.items[0].id;
  await R.she.admin('adminHqPublish', { id });
  r = await R.hq.admin('hqClash', { dates: ['2026-12-20', '2026-12-21'], regions: ['she', 'main', 'ding'] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.clashes.map((x) => [x.regionName, x.date, x.name, x.time]), [['教捨區', '2026-12-20', '測試本區法會', '09:00']]);
  assert.equal((await R.she.admin('hqClash', { dates: ['2026-12-20'], regions: ['she'] })).error.code, 'FORBIDDEN');
});
