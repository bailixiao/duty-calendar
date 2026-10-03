// 前端 js/api.js 的讀取：卡住時同時再問一次、誰先回來用誰；伺服器明確回錯誤不重問。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function loadApi(fakeFetch) {
  const window = { APP_CONFIG: { API_URL: 'https://example.test/exec' } };
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
  new Function('window', 'fetch', 'localStorage', 'AbortController', src)(window, fakeFetch, localStorage, AbortController);
  return window.Api;
}

const ok = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
const never = (opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('第一個請求卡住：同時再送一個，用先回來的', async () => {
  let calls = 0;
  const Api = loadApi((url, opts) => (++calls === 1 ? never(opts) : Promise.resolve(ok({ n: calls }))));
  const t0 = Date.now();
  const data = await Api.getDuty('D-1');
  assert.equal(data.n, 2);
  assert.ok(Date.now() - t0 < 4500, '大約 3.5 秒就換第二個請求');
});

test('伺服器回明確錯誤（找不到勤務）：直接回報，不重問', async () => {
  let calls = 0;
  const Api = loadApi(() => { calls++; return Promise.resolve({ ok: true, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '找不到這個勤務' } }) }); });
  await assert.rejects(Api.getDuty('D-x'), (e) => e.code === 'NOT_FOUND');
  assert.equal(calls, 1);
});

test('連線馬上失敗：立刻再送，不用等', async () => {
  let calls = 0;
  const Api = loadApi(() => (++calls === 1 ? Promise.reject(new Error('net')) : Promise.resolve(ok({ n: calls }))));
  const t0 = Date.now();
  const data = await Api.getDuty('D-1');
  assert.equal(data.n, 2);
  assert.ok(Date.now() - t0 < 500);
});
