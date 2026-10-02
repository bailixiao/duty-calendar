// 本機預覽用的靜態伺服器（不需安裝套件）。執行：node tools/dev-server.js，開啟 http://localhost:5173
// 加上 --mock：不連正式 API，改用記憶體模擬的 Apps Script（tests/env.js，載入初始資料、管理密碼 test-pass），
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

const env = mock ? require('../tests/env').createEnv() : null;

function handleApi(req, res, url) {
  const send = (obj) => {
    res.writeHead(200, { 'Content-Type': types['.json'], 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => send(env.postRaw(body)));
  } else {
    send(env.get(Object.fromEntries(url.searchParams)));
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(url.pathname);
  if (mock && urlPath === '/api') return handleApi(req, res, url);
  if (mock && urlPath === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
    res.end(`window.APP_CONFIG = { API_URL: '/api' };`);
    return;
  }
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
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
}).listen(port, () => console.log(`http://localhost:${port}${mock ? '（模擬 API）' : ''}`));
