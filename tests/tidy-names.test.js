// 🧹 資料整理（2026/11/21）：勤務類的「區闡道班」「闡道班」統一叫「闡道班勤務」；道務的不動。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('資料整理：先列出、按了才改；只改勤務類；寫操作紀錄；唯讀不能用', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const mk = (name, category, nature, start) => call('adminCreateDuties', { duties: [{ name, category, nature, start, end: start, positions: [{ name: '參加' }] }] }).data.ids[0];
  const a = mk('區闡道班', '勤務', '勤務', '2026-11-08');
  const b = mk('闡道班', '勤務', '勤務', '2026-12-06');
  const c = mk('闡道班', '道務', '課程', '2026-12-06');
  const preview = call('adminTidyNames', {}).data.items;
  assert.deepEqual(preview.map((x) => [x.id, x.to]), [[a, '闡道班勤務'], [b, '闡道班勤務']]);
  const name = (id) => env.get({ action: 'getDuty', id }).data.name;
  assert.equal(name(a), '區闡道班', '只看不改');
  assert.equal(call('adminTidyNames', { apply: true }).data.done, 2);
  assert.equal(name(a), '闡道班勤務');
  assert.equal(name(b), '闡道班勤務');
  assert.equal(name(c), '闡道班', '道務的不動');
  assert.deepEqual(call('adminTidyNames', {}).data.items, []);
  assert.ok(call('adminLogs').data.logs.some((l) => /資料整理：區闡道班 → 闡道班勤務/.test(l.summary)));
  call('adminSaveAccount', { account: { account: '唯讀組', role: '唯讀', password: 'pass-1234' } });
  const ro = env.post({ action: 'adminLogin', account: '唯讀組', password: 'pass-1234' }).data.token;
  assert.equal(env.post({ action: 'adminTidyNames', token: ro }).error.code, 'FORBIDDEN');
});
