// 常見問題（apps-script/Faq.gs、FaqSeed.gs）。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./env');

const OCT_6 = Date.UTC(2026, 9, 6, 2, 0, 0);

test('常見問題：沒有資料時用預設題目；家人們只拿到家人們的題目', () => {
  const env = createEnv(OCT_6);
  const items = env.get({ action: 'getFaq' }).data.items;
  assert.ok(items.length >= 30);
  assert.ok(items.every((f) => f.audience === '家人們' && f.enabled));
  assert.ok(items.find((f) => f.id === 'faq-cancel'));
  assert.ok(items.find((f) => f.id === 'faq-home-android'));
});

test('預設題目引用的圖片都存在，題目 ID 不重複，答案裡連到別題的 ID 都有', () => {
  const env = createEnv(OCT_6);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const all = env.post({ action: 'adminFaq', token }).data.all;
  const ids = all.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  all.forEach((f) => {
    (f.a.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []).forEach((m) => {
      const src = m.match(/\(([^)]+)\)/)[1];
      assert.ok(fs.existsSync(path.join(__dirname, '..', src)), f.id + ' 的圖片不存在：' + src);
    });
    (f.a.match(/\]\(#\/help\/([^)]+)\)/g) || []).forEach((m) => {
      const id = m.match(/help\/([^)]+)\)/)[1];
      assert.ok(ids.indexOf(id) !== -1, f.id + ' 連到不存在的題目：' + id);
    });
  });
});

test('後台：管理者題目依角色；只有總管理者能編輯；第一次編輯把預設題目寫進分頁', () => {
  const env = createEnv(OCT_6);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  env.post({ action: 'adminSaveAccount', token, account: { account: '場地', role: '場管', password: 'abc12345' } });
  env.post({ action: 'adminSaveAccount', token, account: { account: '勤務組', role: '勤務', password: 'abc12345' } });
  const venue = env.post({ action: 'adminLogin', account: '場地', password: 'abc12345' }).data.token;
  const duty = env.post({ action: 'adminLogin', account: '勤務組', password: 'abc12345' }).data.token;
  const v = env.post({ action: 'adminFaq', token: venue }).data;
  assert.equal(v.all, undefined, '只有總管理者拿到全部');
  assert.ok(v.items.find((f) => f.id === 'adm-venue'));
  assert.ok(!v.items.find((f) => f.id === 'adm-push'), '場管看不到推播教學');
  assert.equal(env.post({ action: 'adminFaqSave', token: duty, item: { audience: '家人們', category: '其他', q: 'x', a: 'y' } }).error.code, 'FORBIDDEN');

  assert.equal(env.sheets['常見問題'].data.length, 1, '還沒寫入');
  const bad = env.post({ action: 'adminFaqSave', token, item: { audience: '家人們', category: '', q: '', a: '' } });
  assert.equal(bad.error.code, 'VALIDATION');
  const r = env.post({ action: 'adminFaqSave', token, item: { audience: '家人們', category: '其他', q: '測試題目？', a: '1. 第一步', alias: '測試' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(env.sheets['常見問題'].data.length > 30, '預設題目寫進分頁');
  assert.ok(env.get({ action: 'getFaq' }).data.items.find((f) => f.q === '測試題目？'));

  const edited = env.post({ action: 'adminFaqSave', token, item: { id: 'faq-cancel', audience: '家人們', category: '取消改期', q: '怎麼取消？', a: '新答案', enabled: false } });
  assert.equal(edited.ok, true);
  assert.ok(!env.get({ action: 'getFaq' }).data.items.find((f) => f.id === 'faq-cancel'), '停用的不顯示');

  const moved = env.post({ action: 'adminFaqMove', token, id: 'faq-signup-many', dir: -1 }).data.all.filter((f) => f.category === '報名');
  assert.deepEqual(moved.slice(0, 2).map((f) => f.id), ['faq-signup-many', 'faq-signup']);
  const del = env.post({ action: 'adminFaqDelete', token, id: 'faq-contact' });
  assert.equal(del.data.all.find((f) => f.id === 'faq-contact').enabled, false, '預設題目刪除＝不啟用（之後不會又冒出來）');
  assert.ok(!env.get({ action: 'getFaq' }).data.items.find((f) => f.id === 'faq-contact'));
});

test('常見問題跟著新版：沒改過的預設題目用最新內容、新加的預設題目自動出現、改過的不蓋掉', () => {
  const env = createEnv(Date.UTC(2026, 9, 8, 2));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const all0 = env.post({ action: 'adminFaq', token }).data.all;
  const edited = all0.find((f) => f.id === 'faq-font');
  env.post({ action: 'adminFaqSave', token, item: Object.assign({}, edited, { a: '我自己改的答案' }) });
  // 模擬之後的版本：改了一題的答案、加了一題新的
  const D = env.fn('FAQ_DEFAULTS_');
  D.find((f) => f.id === 'faq-signup').a = '新版的報名說明';
  D.find((f) => f.id === 'faq-font').a = '新版的字體說明';
  const at = D.findIndex((f) => f.id === 'faq-signup');
  D.splice(at + 1, 0, { id: 'faq-new-test', audience: '家人們', category: '報名', q: '新功能測試題？', a: '新功能的說明' });
  const items = env.get({ action: 'getFaq' }).data.items;
  assert.equal(items.find((f) => f.id === 'faq-signup').a, '新版的報名說明', '沒改過的跟著新版');
  assert.equal(items.find((f) => f.id === 'faq-font').a, '我自己改的答案', '改過的不蓋掉');
  const ids = items.map((f) => f.id);
  assert.equal(ids[ids.indexOf('faq-signup') + 1], 'faq-new-test', '新題目排在前一題後面');
});
