// 分區（2026/11/19）：每週自動備份、還原、用量提醒、常見問題分區（mainOnly／regionOnly）。
const test = require('node:test');
const assert = require('node:assert');

require('../tools/build-worker.js');

async function makeRegion(region, props) {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const store = createMemoryStore();
  const app = createApp(store);
  Object.entries(props || {}).forEach(([k, v]) => store.setProp(k, v));
  const call = async (method, payload) => {
    const headers = { 'X-Region': region };
    const req = method === 'GET'
      ? new Request('https://w.test/?' + new URLSearchParams(payload), { headers })
      : new Request('https://w.test/', { method: 'POST', headers, body: JSON.stringify(payload) });
    const res = await app.handle(req);
    store.persist();
    return res.json();
  };
  return { store, app, call };
}

/** 像 index.js 的 Durable Object（每個方法呼叫完都 persist） */
function asStub(r) {
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } finally { r.store.persist(); } };
  return {
    cron: wrap(async (when, region) => ({ result: await r.app.cron(when, region), usage: r.app.usageToday() })),
    openRegions: wrap(async () => r.app.openRegions()),
    usageCheck: wrap((t) => r.app.usageCheck(t)),
    backupTo: wrap(async (region, at) => { const t = r.app.snapshot(); r.backup.raw.save(region, at, t); return t.length; }),
    restoreFrom: wrap(async (region, at) => r.app.restore(r.backup.raw.get(region, at)))
  };
}

async function backupStub() {
  const { createMemoryBackups } = await import('../worker/src/backup-store.js');
  const b = createMemoryBackups();
  return { raw: b, saveBackup: async (r, at, t) => b.save(r, at, t), listBackups: async () => b.list(), getBackup: async (r, at) => b.get(r, at) };
}

const OPEN = { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass' };

test('每週備份：週日早上（UTC 週六 23:00）每區各存一份，其他天不存；每區只留 8 份', async () => {
  const { runSchedule, taipeiStamp } = await import('../worker/src/schedule.js');
  const main = await makeRegion('main');
  main.store.setProp('OPEN_REGIONS', JSON.stringify(['she']));
  const she = await makeRegion('she', OPEN);
  const regs = { main, she };
  const backup = await backupStub();
  main.backup = backup; she.backup = backup;
  const opts = (now) => ({ stub: (r) => asStub(regs[r]), now });
  await runSchedule('today', opts(new Date(Date.UTC(2026, 10, 20, 23)))); // 週五
  assert.equal((await backup.listBackups()).length, 0);
  const sat = new Date(Date.UTC(2026, 10, 21, 23));
  assert.equal(taipeiStamp(sat), '2026-11-22 07:00');
  const res = await runSchedule('today', opts(sat));
  assert.deepEqual(Object.keys(res.backup), ['main', 'she']);
  const list = await backup.listBackups();
  assert.deepEqual(list.map((b) => b.region + ' ' + b.at), ['main 2026-11-22 07:00', 'she 2026-11-22 07:00']);
  for (let i = 0; i < 10; i++) backup.raw.save('she', '2027-01-0' + i, '{}');
  assert.equal((await backup.listBackups()).filter((b) => b.region === 'she').length, 8);
});

test('還原：教捨區的勤務被刪掉後，用備份還原回來；還原前先自動備份現在的資料', async () => {
  const { regionAdmin } = await import('../worker/src/region-admin.js');
  const main = await makeRegion('main');
  const she = await makeRegion('she', OPEN);
  const regs = { main, she };
  const backup = await backupStub();
  main.backup = backup; she.backup = backup;
  const run = (body) => regionAdmin(Object.assign({ key: 'k' }, body), { key: 'k', siteBase: 'https://x.test/', stub: (r) => asStub(regs[r]), backup });
  const tok = (await she.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  const made = await she.call('POST', { action: 'adminCreateDuties', token: tok, duties: [{ name: '測試打掃', category: '勤務', nature: '勤務', mode: '報名型', start: '2027-03-01', location: '區中心', positions: [{ name: '打掃', min: 0, max: null }] }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const range = { action: 'getEvents', from: '2027-02-01', to: '2027-03-31' };
  assert.equal((await she.call('GET', range)).data.duties.length, 1);

  assert.equal((await run({ op: 'backup', region: 'nope' })).error.code, 'BAD_REGION');
  assert.equal((await run({ key: 'bad', op: 'backups' })).error.code, 'UNAUTHORIZED');
  const b = await run({ op: 'backup', region: 'she' });
  assert.equal(b.ok, true, JSON.stringify(b.error));
  const at = (await run({ op: 'backups' })).data[0].at;
  assert.match(at, / 手動$/);

  // 弄壞：把勤務刪掉
  const id = (await she.call('GET', range)).data.duties[0].id;
  const del = await she.call('POST', { action: 'adminDeleteDuty', token: tok, id });
  assert.equal(del.ok, true, JSON.stringify(del.error));
  assert.equal((await she.call('GET', range)).data.duties.length, 0);

  assert.equal((await run({ op: 'restore', region: 'she', at: 'nope' })).error.code, 'NOT_FOUND');
  const r = await run({ op: 'restore', region: 'she', at });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal((await she.call('GET', range)).data.duties.length, 1);
  const all = (await run({ op: 'backups' })).data.map((x) => x.at);
  assert.ok(all.some((x) => / 還原前$/.test(x)), all.join());
  // 密碼等設定也還原；後台還能登入
  assert.equal((await she.call('POST', { action: 'adminLogin', password: 'test-pass' })).ok, true);
});

test('用量：每一區自己數，教全區加總到 8 成通知「系統通知」，一天只通知一次', async () => {
  const { runSchedule } = await import('../worker/src/schedule.js');
  const main = await makeRegion('main', { LIVE: '1' });
  main.store.setProp('OPEN_REGIONS', JSON.stringify(['she']));
  const she = await makeRegion('she', OPEN);
  for (let i = 0; i < 25; i++) await she.call('GET', { action: 'ping' });
  assert.equal(she.app.usageToday(), 25);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(she.store.getProp('USAGE:' + day), '20'); // 每 10 次寫一次
  const regs = { main, she };
  const res = await runSchedule('plans', { stub: (r) => asStub(regs[r]), now: new Date() });
  assert.equal(res.usage.alerted, false);
  assert.ok(res.usage.total >= 27); // 25 次＋兩區排程各 1 次

  let sent = 0;
  const orig = main.app.gs.pushMessageTo_;
  main.app.gs.pushMessageTo_ = (targets, title) => { sent += 1; assert.match(title, /用量/); };
  try {
    assert.equal((await main.app.usageCheck(85000)).alerted, true);
    assert.equal((await main.app.usageCheck(90000)).alerted, false); // 同一天不再通知
  } finally { main.app.gs.pushMessageTo_ = orig; }
  assert.equal(sent, 1);
});

test('常見問題：Google 試算表同步那題只有教全區有，區設定那題只有其他區有', async () => {
  const main = await makeRegion('main', { ADMIN_PASSWORD: 'test-pass' });
  const she = await makeRegion('she', Object.assign({ SITE_JSON: JSON.stringify({ name: '教捨區行事曆', org: '教捨區' }) }, OPEN));
  const ids = async (r) => {
    const tok = (await r.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
    const d = (await r.call('POST', { action: 'adminFaq', token: tok })).data;
    return (d.all || d.items).map((f) => f.id);
  };
  const m = await ids(main);
  const s = await ids(she);
  assert.ok(m.includes('adm-system-notify'));
  assert.ok(!m.includes('adm-site'));
  assert.ok(s.includes('adm-site'));
  assert.ok(!s.includes('adm-system-notify'));
});
