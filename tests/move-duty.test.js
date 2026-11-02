// 勤務整筆搬日期（apps-script/DutyAdmin.gs adminMoveDuty_）：舊統計表年份打錯時用。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('整筆搬日期：勤務和報名一起搬到新日期；好幾天的不能搬；只有總管理者能用', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  assert.equal(env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲' }] }).ok, true);
  const r = env.post({ action: 'adminMoveDuty', token: sup, id: ev.id, to: '2025-10-13' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual([r.data.from, r.data.to, r.data.moved], ['2026-10-13', '2025-10-13', 1]);
  const d = env.post({ action: 'adminDuty', token: sup, id: ev.id }).data;
  assert.equal(d.start, '2025-10-13');
  assert.deepEqual(d.signups.map((s) => [s.name, s.date]), [['測試甲', '2025-10-13']]);
  const logs = env.post({ action: 'adminLogs', token: sup, offset: 0, limit: 5 }).data.logs;
  assert.ok(logs.some((l) => l.action === '勤務搬日期'));
  assert.equal(env.post({ action: 'adminMoveDuty', token: sup, id: ev.id, to: '2025-10-13' }).error.code, 'BAD_REQUEST');
  assert.equal(env.post({ action: 'adminMoveDuty', token: sup, id: ev.id, to: '12/11' }).error.code, 'BAD_REQUEST');
  env.post({ action: 'adminSaveAccount', token: sup, account: { account: '總務組', role: '勤務', password: 'abc12345' } });
  const w = env.post({ action: 'adminLogin', account: '總務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminMoveDuty', token: w, id: ev.id, to: '2026-10-13' }).error.code, 'FORBIDDEN');
});
