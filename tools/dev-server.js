// 本機預覽用的靜態伺服器（不需安裝套件）。執行：node tools/dev-server.js，開啟 http://localhost:5173
// 加上 --mock：不連正式 API，改跑和正式相同的 Cloudflare Worker 程式（資料放記憶體，載入 tests/env.js 的初始資料、管理密碼 test-pass），
// 適合在部署前測試新功能，不會動到真的試算表。例：node tools/dev-server.js --mock（預設 port 5175）
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mock = process.argv.includes('--mock');
const port = Number(process.env.PORT) || (mock ? 5175 : 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

let worker = null; // { app, store }
async function startMock() {
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-worker.js')], { stdio: 'inherit' });
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const googleEnv = require('../tests/env').createEnv();
  const sheets = Object.fromEntries(Object.entries(googleEnv.sheets).map(([n, sh]) => [n, sh.data]));
  const store = createMemoryStore();
  const app = createApp(store);
  await app.handle(new Request('http://localhost/', { method: 'POST', body: JSON.stringify({ action: 'import', sheets, props: { ADMIN_PASSWORD: 'test-pass', ADMIN_CONTACT: '測試管理者' } }) }));
  app.gs.ensurePushKeys_(); // 本機測試也能開啟手機提醒
  store.persist();
  worker = { app, store };
}

// 分區（2026/11/19）：一區一份（和正式的 Durable Object 一樣）。教捨區（she）開通好、空的，管理密碼也是 test-pass；其他區沒開通。
const regionWorkers = {};
async function regionWorker(region) {
  if (region === 'main') return worker;
  if (regionWorkers[region]) return regionWorkers[region];
  const { createApp } = await import('../worker/src/app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const { REGIONS } = await import('../worker/src/regions.js');
  const store = createMemoryStore();
  const app = createApp(store);
  if (region === 'she') {
    ['VAPID_PRIVATE', 'VAPID_PUBLIC'].forEach((k) => store.setProp(k, worker.store.getProp(k))); // 推播金鑰各區共用
    Object.entries({
      REGION_OPEN: '1', LIVE: '1', ADMIN_PASSWORD: 'test-pass', ADMIN_CONTACT: '測試管理者',
      SITE_JSON: JSON.stringify({ name: REGIONS.she + '行事曆', org: REGIONS.she, venue: '區中心', locations: ['區中心'], siteUrl: 'http://localhost:' + port + '/she/', aiRegion: REGIONS.she, aiRegionShort: '教捨', shortageTitle: '🙏【教捨區勤務缺人通知】🙏', inviteTitle: '🙏【教捨區 成全邀請】🙏' })
    }).forEach(([k, v]) => store.setProp(k, v));
  }
  store.persist();
  return (regionWorkers[region] = { app, store });
}

async function handleApi(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const { regionOf } = await import('../worker/src/regions.js');
  const region = regionOf(url);
  if (!region) {
    res.writeHead(200, { 'Content-Type': types['.json'] });
    res.end(JSON.stringify({ ok: false, error: { code: 'BAD_REGION', message: '找不到這一區，請確認網址' } }));
    return;
  }
  const w = await regionWorker(region);
  const r = await w.app.handle(new Request('http://localhost/' + url.search, Object.assign({ headers: { 'X-Region': region } }, req.method === 'POST' ? { method: 'POST', body: Buffer.concat(chunks) } : {})));
  w.store.persist();
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(url.pathname);
  if (mock && urlPath === '/api') return handleApi(req, res, url);
  if (mock && urlPath === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.APP_CONFIG = { API_URL: '/api' };`);
    return;
  }
  const file = path.join(root, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath); // 資料夾（例：/she/、/j/）開裡面的 index.html
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
(mock ? startMock() : Promise.resolve()).then(() => server.listen(port, () => console.log(`http://localhost:${port}${mock ? '（模擬 API，跑 Worker 程式）' : ''}`)));
