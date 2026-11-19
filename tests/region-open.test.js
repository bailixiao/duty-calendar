// 分區 ②（2026/11/19）：開通工具（金鑰、開通連結）、總管理者自己設密碼、後台「⚙️ 區設定」、常見問題換成這一區的名字。
const test = require('node:test');
const assert = require('node:assert');

require('../tools/build-worker.js'); // 用最新的 apps-script/*.gs 產生 Worker 程式

/** 一區一份（像正式的 Durable Object）；region 是 X-Region */
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

/** 像 index.js 一樣把 app 包成「Durable Object」給開通工具用 */
const asStub = (r) => ({
  vapidKeys: async () => { try { return r.app.vapidKeys(); } finally { r.store.persist(); } },
  openRegion: async (x) => { try { return r.app.openRegion(x); } finally { r.store.persist(); } },
  addOpenRegion: async (x) => { try { return r.app.addOpenRegion(x); } finally { r.store.persist(); } }
});

async function openViaTool(code) {
  const { regionAdmin } = await import('../worker/src/region-admin.js');
  const main = await makeRegion('main');
  const reg = await makeRegion(code);
  const regs = { main, [code]: reg };
  const run = (body) => regionAdmin(body, { key: 'k-123', siteBase: 'https://x.test/dc/', stub: (r) => asStub(regs[r]) });
  return { main, reg, run };
}

test('開通工具：金鑰不對、區不認得都擋下；開通後這一區能用、有預設設定、推播金鑰和教全區一樣、教全區記下來', async () => {
  const { main, reg, run } = await openViaTool('fa');
  assert.equal((await run({ key: 'wrong', region: 'fa' })).error.code, 'UNAUTHORIZED');
  assert.equal((await run({ region: 'fa' })).error.code, 'UNAUTHORIZED');
  assert.equal((await run({ key: 'k-123', region: 'main' })).error.code, 'BAD_REGION');
  assert.equal((await run({ key: 'k-123', region: 'nope' })).error.code, 'BAD_REGION');
  const { regionAdmin } = await import('../worker/src/region-admin.js');
  assert.equal((await regionAdmin({ key: '', region: 'fa' }, { key: '', siteBase: '', stub: () => null })).error.code, 'CONFIG');
  assert.equal((await reg.call('GET', { action: 'getSite' })).error.code, 'NOT_OPEN');

  const out = await run({ key: 'k-123', region: 'fa' });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.data.first, true);
  assert.equal(out.data.hasPassword, false);
  assert.match(out.data.link, /^https:\/\/x\.test\/dc\/fa\/#\/setup\/[0-9a-f]{40}$/);
  assert.equal(reg.store.getProp('SETUP_TOKEN').includes(out.data.token), false); // 只存雜湊
  const site = (await reg.call('GET', { action: 'getSite' })).data;
  assert.equal(site.name, '教發區行事曆');
  assert.equal(site.org, '教發區');
  assert.deepEqual(site.locations, ['區中心']);
  assert.deepEqual(site.overseas, []); // 教全區的國外選項不帶過來
  assert.equal(site.siteUrl, 'https://jiaoquan-cal.pages.dev/fa/'); // 網站網址以程式的 SITE_BASE 為準（2026/11/19 搬家）
  assert.ok(reg.store.getProp('VAPID_PUBLIC'));
  assert.equal(reg.store.getProp('VAPID_PUBLIC'), main.store.getProp('VAPID_PUBLIC'));
  assert.deepEqual(main.app.openRegions(), ['fa']);
  // 還沒設密碼：後台登不進去
  assert.equal((await reg.call('POST', { action: 'adminLogin', password: '' })).ok, false);
  // 再開一次：換新的連結，舊的失效，設定不會被蓋掉
  reg.store.setProp('SITE_JSON', JSON.stringify(Object.assign({}, site, { venue: '佛堂' })));
  const again = await run({ key: 'k-123', region: 'fa' });
  assert.equal(again.data.first, false);
  assert.equal((await reg.call('POST', { action: 'regionSetupCheck', token: out.data.token })).error.code, 'BAD_TOKEN');
  assert.equal((await reg.call('POST', { action: 'regionSetupCheck', token: again.data.token })).ok, true);
  assert.equal((await reg.call('GET', { action: 'getSite' })).data.venue, '佛堂');
  assert.deepEqual(main.app.openRegions(), ['fa']);
});

test('開通連結：總管理者自己設密碼，只能用一次，過期不能用', async () => {
  const { reg, run } = await openViaTool('she');
  const { token } = (await run({ key: 'k-123', region: 'she' })).data;
  assert.equal((await reg.call('POST', { action: 'regionSetupCheck', token: 'ab'.repeat(20) })).error.code, 'BAD_TOKEN');
  assert.equal((await reg.call('POST', { action: 'regionSetupCheck' })).error.code, 'BAD_TOKEN');
  const chk = await reg.call('POST', { action: 'regionSetupCheck', token });
  assert.deepEqual(chk.data, { org: '教捨區', hasPassword: false });
  assert.equal((await reg.call('POST', { action: 'regionSetup', token, password: '  ' })).error.code, 'BAD_REQUEST');
  assert.equal((await reg.call('POST', { action: 'regionSetup', token, password: 'test-pass' })).ok, true);
  assert.equal((await reg.call('POST', { action: 'regionSetup', token, password: 'other' })).error.code, 'BAD_TOKEN');
  const login = await reg.call('POST', { action: 'adminLogin', password: 'test-pass' });
  assert.equal(login.ok, true, JSON.stringify(login.error));
  // 過期
  const t2 = (await run({ key: 'k-123', region: 'she' })).data.token;
  assert.equal((await reg.call('POST', { action: 'regionSetupCheck', token: t2 })).data.hasPassword, true);
  reg.store.setProp('SETUP_EXPIRES', String(Date.now() - 1));
  assert.equal((await reg.call('POST', { action: 'regionSetup', token: t2, password: 'x' })).error.code, 'BAD_TOKEN');
});

test('區設定：其他區的總管理者可以改，存好後網站設定、地點選項跟著換；常見問題換成這一區的名字；教全區不能用', async () => {
  const { reg, run } = await openViaTool('she');
  const { token } = (await run({ key: 'k-123', region: 'she' })).data;
  await reg.call('POST', { action: 'regionSetup', token, password: 'test-pass' });
  const tok = (await reg.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  const got = await reg.call('POST', { action: 'adminSiteGet', token: tok });
  assert.equal(got.ok, true, JSON.stringify(got.error));
  assert.equal(got.data.site.org, '教捨區');
  const faq = JSON.stringify((await reg.call('GET', { action: 'getFaq' })).data.items);
  assert.equal(faq.includes('教全區'), false);

  const site = {
    org: '教捨區', venue: '佛堂', locations: '區中心\n測試地點、測試地點', categoryLabels: { 勤務: '總務', 道務: '道務', 教育: '教育' },
    eduTeacherClasses: '讀經班', overseas: '', shortageTitle: '缺人', inviteTitle: '邀請', features: { venue: false, repair: true, help: true, push: true }
  };
  assert.equal((await reg.call('POST', { action: 'adminSiteSave', token: tok, site: Object.assign({}, site, { org: '' }) })).error.code, 'BAD_REQUEST');
  assert.equal((await reg.call('POST', { action: 'adminSiteSave', token: tok, site: Object.assign({}, site, { locations: '' }) })).error.code, 'BAD_REQUEST');
  const saved = await reg.call('POST', { action: 'adminSiteSave', token: tok, site, contact: '總務組' });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const s = (await reg.call('GET', { action: 'getSite' })).data;
  assert.deepEqual(s.locations, ['區中心', '測試地點']);
  assert.equal(s.venue, '佛堂');
  assert.deepEqual(s.features, { venue: false, repair: true, help: true, push: true });
  assert.equal(s.categoryLabels['勤務'], '總務');
  assert.equal(s.siteUrl, 'https://jiaoquan-cal.pages.dev/she/'); // 網址不會被改掉（以 SITE_BASE 為準）
  assert.equal(reg.app.gs.OPTIONS.location.join(), '區中心,測試地點');
  assert.equal(reg.store.getProp('ADMIN_CONTACT'), '總務組');
  // 存完還是登入中（沒有清掉通行碼）
  assert.equal((await reg.call('POST', { action: 'adminSiteGet', token: tok })).ok, true);
  // 沒登入不行
  assert.equal((await reg.call('POST', { action: 'adminSiteSave', token: 'bad', site })).ok, false);
  // 教全區：不能用區設定，常見問題不變
  const main = await makeRegion('main', { ADMIN_PASSWORD: 'test-pass' });
  const mt = (await main.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  assert.equal((await main.call('POST', { action: 'adminSiteGet', token: mt })).error.code, 'FORBIDDEN');
  assert.ok(JSON.stringify((await main.call('GET', { action: 'getFaq' })).data.items).includes('區中心'));
});
