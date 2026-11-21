// 🧹 資料整理（2026/11/21）：列出每個類別的名稱，勾好幾個合成一個名稱；先列出、按了才改。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('資料整理：列出名稱；勾的合成一個；只改同類別；寫操作紀錄；唯讀不能用', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const mk = (name, category, nature, start) => call('adminCreateDuties', { duties: [{ name, category, nature, start, end: start, positions: [{ name: '參加' }] }] }).data.ids[0];
  const a = mk('區闡道班', '勤務', '勤務', '2026-11-08');
  const b = mk('闡道班', '勤務', '勤務', '2026-12-06');
  const c = mk('闡道班', '道務', '課程', '2026-12-06');
  const names = call('adminTidyNames', {}).data.names;
  const n = names.find((x) => x.category === '勤務' && x.name === '區闡道班');
  assert.deepEqual([n.count, n.first, n.last], [1, '2026-11-08', '2026-11-08']);
  assert.ok(names.some((x) => x.category === '道務' && x.name === '闡道班'));

  const body = { category: '勤務', from: ['區闡道班', '闡道班'], to: '闡道班勤務' };
  assert.deepEqual(call('adminTidyNames', body).data.items.map((x) => x.id), [a, b]);
  const name = (id) => env.get({ action: 'getDuty', id }).data.name;
  assert.equal(name(a), '區闡道班', '只看不改');
  assert.equal(call('adminTidyNames', Object.assign({ apply: true }, body)).data.done, 2);
  assert.equal(name(a), '闡道班勤務');
  assert.equal(name(b), '闡道班勤務');
  assert.equal(name(c), '闡道班', '道務的不動');
  assert.equal(call('adminTidyNames', Object.assign({ apply: true }, body)).error.code, 'BAD_REQUEST', '沒有要改的');
  assert.equal(call('adminTidyNames', { category: '勤務', from: ['闡道班勤務'], to: ' ' }).error.code, 'BAD_REQUEST');
  assert.ok(call('adminLogs').data.logs.some((l) => /資料整理：區闡道班 → 闡道班勤務/.test(l.summary)));
  call('adminSaveAccount', { account: { account: '唯讀組', role: '唯讀', password: 'pass-1234' } });
  const ro = env.post({ action: 'adminLogin', account: '唯讀組', password: 'pass-1234' }).data.token;
  assert.equal(env.post({ action: 'adminTidyNames', token: ro }).error.code, 'FORBIDDEN');
});
