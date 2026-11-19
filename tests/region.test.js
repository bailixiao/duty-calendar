// 分區（2026/11/19）：各區的資料分開、沒開通的區擋下來、各區的網站設定、前後端的區清單一致、產生的轉址頁。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('../tools/build-worker.js'); // 用最新的 apps-script/*.gs 產生 Worker 程式
const root = path.join(__dirname, '..');
const { createEnv } = require('./env.js');

async function load() {
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const regions = await import('../worker/src/regions.js');
  return { createApp, createMemoryStore, regions };
}

/** 一區一份（像正式的 Durable Object）；region 是 X-Region */
async function makeRegion(region, props) {
  const { createApp, createMemoryStore } = await load();
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

const SHE_SITE = { name: '教捨區行事曆', org: '教捨區', venue: '區中心', locations: ['區中心', '測試地點'], siteUrl: 'https://example.test/she/', features: { venue: false } };
const openShe = () => makeRegion('she', { REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass', SITE_JSON: JSON.stringify(SHE_SITE) });

test('區代號：沒帶是教全區（main），認得的代號照用，不認得的回 null', async () => {
  const { regions } = await load();
  const of = (q) => regions.regionOf(new URL('https://w.test/' + q));
  assert.equal(of(''), 'main');
  assert.equal(of('?region=main'), 'main');
  assert.equal(of('?region=she'), 'she');
  assert.equal(of('?action=getEvents&region=zhen'), 'zhen');
  assert.equal(of('?region=abc'), null);
  assert.equal(of('?region=__proto__'), null);
  assert.equal(Object.keys(regions.REGIONS).length, 12);
});

test('前端 js/region.js 的區清單和後端一樣', async () => {
  const { regions } = await load();
  const win = { SITE: { org: '教全區' } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'region.js'), 'utf8'), { window: win, location: { search: '', origin: 'https://x.test', pathname: '/duty-calendar/' }, document: {}, Storage: undefined, URL });
  assert.deepEqual({ ...win.Region.REGIONS }, regions.REGIONS);
  assert.equal(win.Region.code, '');
  assert.equal(win.Region.api('https://api.test/'), 'https://api.test/'); // 教全區不加
  assert.equal(win.Region.home(), 'https://x.test/duty-calendar/');
});

test('前端：其他區的 API 網址加 region、分享網址是 …/she/、手機裡記的東西分開', async () => {
  const store = new Map();
  function Storage() {}
  Storage.prototype.getItem = function (k) { return store.has(k) ? store.get(k) : null; };
  Storage.prototype.setItem = function (k, v) { store.set(k, String(v)); };
  Storage.prototype.removeItem = function (k) { store.delete(k); };
  const localStorage = new Storage();
  const win = { SITE: { name: '教全區行事曆', org: '教全區', venue: '區中心', locations: ['宏宗'] }, Storage };
  const doc = { title: '', querySelector: () => null };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'region.js'), 'utf8'), { window: win, Storage, localStorage, location: { search: '?r=she&openExternalBrowser=1', origin: 'https://x.test', pathname: '/duty-calendar/index.html' }, document: doc, URL });
  assert.equal(win.Region.code, 'she');
  assert.equal(win.Region.name, '教捨區');
  assert.equal(win.Region.api('https://api.test/'), 'https://api.test/?region=she');
  assert.equal(win.Region.api('/api?x=1'), '/api?x=1&region=she');
  assert.equal(win.Region.home(), 'https://x.test/duty-calendar/she/');
  // 網站名稱先用這一區的預設；教全區的地點不會帶過來
  assert.equal(win.SITE.name, '教捨區行事曆');
  assert.deepEqual([...win.SITE.locations], []);
  assert.equal(doc.title, '教捨區行事曆');
  // 手機裡記的東西：其他區自動加代號；字體大小共用；不是 duty-calendar: 開頭的不動
  localStorage.setItem('duty-calendar:mine-name', '測試甲');
  localStorage.setItem('duty-calendar:text-size', 'l');
  localStorage.setItem('other', '1');
  assert.deepEqual([...store.keys()].sort(), ['duty-calendar:she:mine-name', 'duty-calendar:text-size', 'other']);
  assert.equal(localStorage.getItem('duty-calendar:mine-name'), '測試甲');
  localStorage.removeItem('duty-calendar:mine-name');
  assert.equal(store.has('duty-calendar:she:mine-name'), false);
});

test('沒開通的區：所有請求都回「還沒開通」，也不跑排程', async () => {
  const { call, app } = await makeRegion('zhen');
  for (const r of [await call('GET', { action: 'getEvents', from: '2026-10-01', to: '2026-10-31' }), await call('GET', { action: 'getSite' }), await call('POST', { action: 'adminLogin', password: 'x' })]) {
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'NOT_OPEN');
  }
  assert.deepEqual(await app.cron('today', 'zhen'), { skipped: 'not-open' });
});

test('各區資料分開：教捨區新增的勤務、報名，教全區看不到；反過來也是', async () => {
  const googleEnv = createEnv(Date.UTC(2026, 9, 1, 2));
  const sheets = Object.fromEntries(Object.entries(googleEnv.sheets).map(([n, s]) => [n, s.data]));
  const main = await makeRegion('main');
  const imp = await main.call('POST', { action: 'import', sheets, props: { ADMIN_PASSWORD: 'test-pass' } });
  assert.equal(imp.ok, true, JSON.stringify(imp.error));
  const she = await openShe();

  const range = { action: 'getEvents', from: '2026-10-01', to: '2027-04-30' };
  const mainBefore = (await main.call('GET', range)).data.duties.length;
  assert.ok(mainBefore > 0);
  assert.equal((await she.call('GET', range)).data.duties.length, 0); // 新的區是空的

  const tok = (await she.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  const made = await she.call('POST', { action: 'adminCreateDuties', token: tok, duties: [{ name: '教捨區測試打掃', category: '勤務', nature: '勤務', mode: '報名型', start: '2027-03-01', location: '區中心', positions: [{ name: '打掃', min: 0, max: null }] }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const duty = (await she.call('GET', range)).data.duties[0];
  const sign = await she.call('POST', { action: 'signup', dutyId: duty.id, positionId: duty.positions[0].id, dates: ['2027-03-01'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(sign.ok, true, JSON.stringify(sign.error));

  assert.equal((await main.call('GET', range)).data.duties.length, mainBefore);
  assert.equal((await main.call('GET', range)).data.duties.some((d) => d.name === '教捨區測試打掃'), false);
  assert.equal((await main.call('GET', { action: 'getDuty', id: duty.id })).ok, false);
  // 教捨區的通行碼在教全區不能用，教全區的也不能在教捨區用
  assert.equal((await main.call('POST', { action: 'adminDuties', token: tok })).ok, false);
  const mainTok = (await main.call('POST', { action: 'adminLogin', password: 'test-pass' })).data.token;
  assert.equal((await she.call('POST', { action: 'adminDuties', token: mainTok })).ok, false);
});

test('各區的網站設定：教捨區用 SITE_JSON，教全區維持原值（同一份程式切換也不會混）', async () => {
  const { createApp, createMemoryStore } = await load();
  // 同一個程式先處理教捨區、再處理教全區（Worker 裡每區各自一份，這裡更嚴格：設定每次請求都重新套用）
  const she = await openShe();
  const s = (await she.call('GET', { action: 'getSite' })).data;
  assert.equal(s.name, '教捨區行事曆');
  assert.deepEqual(s.locations, ['區中心', '測試地點']);
  assert.deepEqual(s.features, { venue: false });
  assert.equal(s.aiRegion, undefined); // 不公開
  assert.equal(she.app.gs.OPTIONS.location.join(), '區中心,測試地點');

  const main = await makeRegion('main');
  const m = (await main.call('GET', { action: 'getSite' })).data;
  assert.equal(m.name, '教全區行事曆');
  assert.equal(m.locations[0], '宏宗');
  assert.equal(m.features, undefined);
  // 同一個 gs 拿掉 SITE_JSON 後回到預設值
  she.store.deleteProp('SITE_JSON');
  assert.equal((await she.call('GET', { action: 'getSite' })).data.name, '教全區行事曆');
  assert.ok(createApp && createMemoryStore);
});

test('教全區記著哪些區開通了（排程用），不認得的代號會被濾掉', async () => {
  const main = await makeRegion('main');
  assert.deepEqual(main.app.openRegions(), []);
  main.store.setProp('OPEN_REGIONS', JSON.stringify(['she', 'nope', 'zhen']));
  assert.deepEqual(main.app.openRegions(), ['she', 'zhen']);
  main.store.setProp('OPEN_REGIONS', '壞掉');
  assert.deepEqual(main.app.openRegions(), []);
});

test('推播：pushSummary 的 sent 只在這一區剛送過推播給這支手機時是 true，拿過就清掉', async () => {
  const she = await openShe();
  const id = she.app.gs.pushIdOf_('https://push.example.test/abc');
  assert.equal((await she.call('GET', { action: 'pushSummary', id })).data.sent, false);
  she.app.gs.cacheForAsync_().put('pushsent:' + id, '1', 900);
  assert.equal((await she.call('GET', { action: 'pushSummary', id })).data.sent, true);
  assert.equal((await she.call('GET', { action: 'pushSummary', id })).data.sent, false);
});

test('產生的分區頁面：轉址頁、短網址、加到主畫面的設定都在，而且是最新的', async () => {
  const { regions } = await load();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const jPage = fs.readFileSync(path.join(root, 'j', 'index.html'), 'utf8');
  for (const [code, name] of Object.entries(regions.REGIONS)) {
    const page = fs.readFileSync(path.join(root, code, 'index.html'), 'utf8');
    assert.ok(page.includes(`'../?r=${code}'`), code + ' 轉址頁');
    assert.ok(page.includes(name), code + ' 區名');
    assert.equal(fs.readFileSync(path.join(root, code, 'j', 'index.html'), 'utf8'), jPage, code + ' 短網址（請執行 node tools/build-regions.js）');
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifests', code + '.webmanifest'), 'utf8'));
    assert.equal(m.name, name + '行事曆');
    assert.equal(m.start_url, '../?r=' + code);
    assert.equal(m.icons.length, manifest.icons.length);
    m.icons.forEach((i) => assert.ok(fs.existsSync(path.join(root, 'manifests', i.src)), i.src));
  }
  // 轉址頁真的會轉到 ?r=<代號>，並帶上原本的 ?… 和 #…
  const page = fs.readFileSync(path.join(root, 'she', 'index.html'), 'utf8');
  const js = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  let to = '';
  vm.runInNewContext(js, { location: { search: '?openExternalBrowser=1', hash: '#/duty/D-1?date=2027-03-01', replace: (u) => { to = u; } } });
  assert.equal(to, '../?r=she&openExternalBrowser=1#/duty/D-1?date=2027-03-01');
});
