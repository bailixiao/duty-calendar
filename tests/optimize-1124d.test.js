// 2026/11/24 優化（四）：意見回饋（Feedback.gs）、後台程式進後台才下載（index.html 的 type="text/x-admin"）。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./env');

test('意見回饋：家人們送出、總管理者看、改狀態、寫處理說明；要處理的事算未讀', () => {
  const env = createEnv(Date.UTC(2026, 10, 24, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(env.post({ action: 'sendFeedback', text: ' ' }).ok, false, '沒寫內容');
  const r = env.post({ action: 'sendFeedback', text: '報名的時候找不到我的名字', name: '測試甲', page: '#/duty/x' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  env.post({ action: 'sendFeedback', text: '希望字可以再大一點' });
  let list = call('adminFeedbackList', {}).data.items;
  assert.equal(list.length, 2);
  const mine = list.find((x) => x.name === '測試甲');
  assert.deepEqual([mine.status, mine.page], ['未讀', '#/duty/x']);
  assert.equal(call('adminTodo', {}).data.feedback, 2);
  list = call('adminFeedbackSet', { id: mine.id, status: '已處理', note: '已經說明了' }).data.items;
  const done = list.find((x) => x.id === mine.id);
  assert.deepEqual([done.status, done.note, done.by], ['已處理', '已經說明了', '總管理者']);
  assert.equal(call('adminTodo', {}).data.feedback, 1);
  // 電話不收、回傳也沒有電話欄位
  assert.equal(Object.keys(done).some((k) => /phone|電話/.test(k)), false);
});

test('意見回饋：只有總管理者能看', () => {
  const env = createEnv(Date.UTC(2026, 10, 24, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const acc = env.post({ action: 'adminSaveAccount', token, account: { account: 'eduacc', role: '教育', password: 'edu-pass-1234' } });
  assert.equal(acc.ok, true, JSON.stringify(acc.error));
  const t2 = env.post({ action: 'adminLogin', account: 'eduacc', password: 'edu-pass-1234' }).data.token;
  assert.equal(env.post({ action: 'adminFeedbackList', token: t2 }).error.code, 'FORBIDDEN');
});

test('index.html：後台才用的程式不在一打開就下載；家人們的頁面沒有用到它們', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const lazy = [...html.matchAll(/<script type="text\/x-admin" src="js\/([\w-]+)\.js\?v=/g)].map((m) => m[1]);
  const eager = [...html.matchAll(/<script src="js\/([\w-]+)\.js\?v=/g)].map((m) => m[1]);
  assert.ok(lazy.indexOf('admin') !== -1 && lazy.indexOf('admin-stats') !== -1);
  assert.ok(eager.indexOf('app') !== -1 && eager.indexOf('calendar') !== -1 && eager.indexOf('feedback') !== -1);
  assert.match(html, /<meta name="app-version" content="[\w-]+">/);
  // 後台程式定義的全域名稱，家人們的頁面（立刻載入的）只有 app.js（進後台）、help.js、feedback.js（裡面後台的那一頁）會用到
  const globals = new Set();
  lazy.forEach((f) => {
    const src = fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8');
    for (const m of src.matchAll(/(?:window|root)\.([A-Z][A-Za-z]+) = /g)) globals.add(m[1]);
  });
  eager.forEach((f) => {
    if (f === 'app' || f === 'help' || f === 'feedback') return; // 只在後台頁面裡用到
    const src = fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8');
    globals.forEach((g) => assert.ok(!new RegExp('\\b' + g + '\\b').test(src), `${f}.js 用到後台的 ${g}（要嘛放進立刻載入，要嘛加 window.${g} && 判斷）`));
  });
});
