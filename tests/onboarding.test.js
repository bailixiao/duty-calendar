// 新區「🚀 開始使用」（2026/11/21）：每一步從資料判斷做完沒有；教全區沒有；幹部帳號不能看。
const test = require('node:test');
const assert = require('node:assert');

require('../tools/build-worker.js');

async function makeRegion(region, props) {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const store = createMemoryStore(); store.setProp('NEWCOMER_INFO', '0'); // 新朋友要填佛堂、生日：舊測試先關掉
  const app = createApp(store);
  Object.entries(props || {}).forEach(([k, v]) => store.setProp(k, v));
  const call = async (payload) => {
    const req = new Request('https://w.test/', { method: 'POST', headers: { 'X-Region': region }, body: JSON.stringify(payload) });
    const res = await app.handle(req);
    store.persist();
    return res.json();
  };
  return { store, call };
}

test('開始使用：存區設定、加成員、新增勤務、傳網址都會打勾；可以先不要顯示', async () => {
  const r = await makeRegion('she', { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const token = (await r.call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  const call = (action, body) => r.call(Object.assign({ action, token }, body));
  const st = async () => (await call('adminOnboarding')).data;
  const s0 = await st();
  assert.equal(s0.siteSaved, false);
  assert.equal(s0.shared, false);
  assert.equal(s0.hidden, false);

  const site = (await call('adminSiteGet')).data.site;
  const saved = await call('adminSiteSave', { site: Object.assign({ shortageTitle: '缺人', inviteTitle: '邀請' }, site) });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.equal((await st()).siteSaved, true);

  const before = await st();
  await call('adminSaveMember', { member: { name: '測試甲', identity: '道親' } });
  const made = await call('adminCreateDuties', { duties: [{ name: '測試勤務', category: '勤務', start: '2026-12-20', end: '2026-12-20', positions: [{ name: '打掃' }] }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const after = await st();
  assert.ok(after.duties > before.duties);

  assert.equal((await call('adminOnboardingMark', { key: 'shared' })).data.shared, true);
  assert.equal((await call('adminOnboardingMark', { key: 'hide' })).data.hidden, true);
  assert.equal((await call('adminOnboardingMark', { key: 'hide', on: false })).data.hidden, false);
  assert.equal((await call('adminOnboardingMark', { key: 'nope' })).ok, false);
});

test('開始使用：教全區沒有；幹部帳號不能看', async () => {
  const m = await makeRegion('main', { LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const tok = (await m.call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  assert.equal((await m.call({ action: 'adminOnboarding', token: tok })).ok, false);

  const r = await makeRegion('she', { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const sup = (await r.call({ action: 'adminLogin', password: 'test-pass' })).data.token;
  await r.call({ action: 'adminSaveAccount', token: sup, account: { account: '測試組', role: '勤務', password: 'pass-1234' } });
  const t2 = (await r.call({ action: 'adminLogin', account: '測試組', password: 'pass-1234' })).data.token;
  assert.equal((await r.call({ action: 'adminOnboarding', token: t2 })).error.code, 'FORBIDDEN');
});
