// 改自己的密碼（2026/11/19）：每個帳號都能改（要舊密碼）；教全區的總管理者改了以後，Google 端同步時跟著換成新密碼。
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
  return { store, app, call };
}

const login = async (r, password, account) => (await r.call({ action: 'adminLogin', password, account })).data;

test('總管理者改密碼：舊密碼要對；改好後這台繼續登入，下次用新密碼', async () => {
  const r = await makeRegion('she', { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const tok = (await login(r, 'test-pass')).token;
  const ch = (o, n) => r.call({ action: 'adminChangeMyPassword', token: tok, oldPassword: o, newPassword: n });
  assert.equal((await ch('wrong', 'new-pass')).error.message, '舊密碼不正確');
  assert.equal((await ch('test-pass', '')).error.message, '請輸入新密碼');
  assert.equal((await ch('test-pass', 'test-pass')).error.message, '新密碼和舊密碼一樣');
  const ok = await ch('test-pass', 'new-pass');
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal((await r.call({ action: 'adminPing', token: tok })).ok, true); // 這台繼續登入
  assert.equal((await r.call({ action: 'adminLogin', password: 'test-pass' })).ok, false);
  assert.equal((await r.call({ action: 'adminLogin', password: 'new-pass' })).ok, true);
  assert.equal(r.store.getProp('PREV_ADMIN_PASSWORD'), undefined); // 其他區沒有 Google 端，不用記舊的
});

test('幹部帳號也能改自己的密碼', async () => {
  const r = await makeRegion('she', { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const sup = (await login(r, 'test-pass')).token;
  const made = await r.call({ action: 'adminSaveAccount', token: sup, account: { account: '測試組', role: '唯讀', password: 'old-pass-1' } });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const tok = (await login(r, 'old-pass-1', '測試組')).token;
  const res = await r.call({ action: 'adminChangeMyPassword', token: tok, oldPassword: 'old-pass-1', newPassword: 'new-pass-1' });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal((await r.call({ action: 'adminLogin', account: '測試組', password: 'old-pass-1' })).ok, false);
  assert.equal((await r.call({ action: 'adminLogin', account: '測試組', password: 'new-pass-1' })).ok, true);
  assert.equal(r.store.getProp('ADMIN_PASSWORD'), 'test-pass'); // 總管理者的不受影響
});

test('教全區：總管理者改密碼後，Google 端拿舊密碼來同步會拿到新密碼；換成新密碼後舊的就不能用了', async () => {
  const r = await makeRegion('main', { LIVE: '1', ADMIN_PASSWORD: 'test-pass' });
  const tok = (await login(r, 'test-pass')).token;
  const res = await r.call({ action: 'adminChangeMyPassword', token: tok, oldPassword: 'test-pass', newPassword: 'new-pass' });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const sync1 = await r.call({ action: 'syncExport', password: 'test-pass' });
  assert.equal(sync1.ok, true, JSON.stringify(sync1.error));
  assert.equal(sync1.data.adminPassword, 'new-pass');
  const sync2 = await r.call({ action: 'syncExport', password: 'new-pass' });
  assert.equal(sync2.ok, true);
  assert.equal(sync2.data.adminPassword, undefined);
  assert.equal((await r.call({ action: 'syncExport', password: 'test-pass' })).ok, false);
});
