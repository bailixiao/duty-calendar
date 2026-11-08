// 活動回報（apps-script/ActivityReport.gs）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('活動回報：後台產生回報碼；當天起 30 天內、回報碼對才能填；可修改；後台勤務頁看得到，同名勤務也看得到以前的回報', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0)); // 10/1
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const admin = (action, body) => env.post(Object.assign({ action, token }, body));
  const made = admin('adminCreateDuties', { duties: [
    { name: '測試園遊會', category: '勤務', nature: '活動', mode: '報名型', start: '2026-10-10', positions: [{ name: '參加', min: 0, max: null }] },
    { name: '測試園遊會', category: '勤務', nature: '活動', mode: '公告型', start: '2026-11-20' }
  ] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const [id1, id2] = made.data.ids;
  assert.equal(admin('adminReportLink', { dutyId: id1, date: '2026-10-11' }).error.code, 'BAD_REQUEST', '日期不在勤務期間');
  const link = admin('adminReportLink', { dutyId: id1, date: '2026-10-10' });
  assert.equal(link.ok, true, JSON.stringify(link.error));
  assert.match(link.data.code, /^\d{4}$/);
  assert.equal(admin('adminReportLink', { dutyId: id1, date: '2026-10-10' }).data.code, link.data.code, '同一天固定一組');
  const p = { dutyId: id1, date: '2026-10-10', code: link.data.code };
  assert.match(env.post(Object.assign({ action: 'reportGet' }, p)).error.message, /當天/, '還沒到活動那天');

  env.clock.now = Date.UTC(2026, 9, 10, 10, 0, 0); // 10/10 晚上
  const wrong = link.data.code === '1234' ? '5678' : '1234';
  assert.equal(env.post({ action: 'reportGet', dutyId: id1, date: '2026-10-10', code: wrong }).error.code, 'FORBIDDEN');
  const got = env.post(Object.assign({ action: 'reportGet' }, p));
  assert.equal(got.ok, true, JSON.stringify(got.error));
  assert.equal(got.data.duty.name, '測試園遊會');
  assert.equal(got.data.report.overall, '');
  const empty = env.post(Object.assign({ action: 'reportSave', name: '測試甲' }, p));
  assert.equal(empty.error.code, 'VALIDATION');
  const saved = env.post(Object.assign({ action: 'reportSave', name: '測試甲', overall: '順利', problems: '音響太小聲', improve: '提早試音', photos: ['F-abcdef123456', 'bad'] }, p));
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.deepEqual([saved.data.report.problems, saved.data.report.photos], ['音響太小聲', ['F-abcdef123456']]);
  env.clock.now = Date.UTC(2026, 9, 12, 2, 0, 0); // 10/12：修改
  assert.equal(env.post(Object.assign({ action: 'reportSave', name: '測試甲', overall: '順利，人很多', problems: '音響太小聲', improve: '提早試音' }, p)).ok, true);
  const logs = admin('adminLogs', { offset: 0, limit: 5 }).data.logs;
  assert.ok(logs.some((l) => /活動回報/.test(JSON.stringify(l)) && /修改/.test(JSON.stringify(l))));

  const d1 = admin('adminDuty', { id: id1 }).data;
  assert.deepEqual(d1.reports.map((r) => [r.date, r.overall, r.name]), [['2026-10-10', '順利，人很多', '測試甲']]);
  assert.deepEqual(d1.reportLinks, ['2026-10-10']);
  const d2 = admin('adminDuty', { id: id2 }).data;
  assert.deepEqual(d2.reports, []);
  assert.deepEqual(d2.pastReports.map((r) => [r.date, r.improve]), [['2026-10-10', '提早試音']], '同名勤務以前的回報');
  assert.doesNotMatch(JSON.stringify(env.get({ action: 'getDuty', id: id1 }).data), /音響太小聲/, '公開頁看不到回報');

  env.clock.now = Date.UTC(2026, 10, 10, 2, 0, 0); // 11/10：超過 30 天
  assert.match(env.post(Object.assign({ action: 'reportGet' }, p)).error.message, /過期/);
});

test('活動回報：回報碼錯 5 次鎖住', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const id = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '測試活動', category: '勤務', nature: '活動', mode: '公告型', start: '2026-10-01' }] }).data.ids[0];
  const code = env.post({ action: 'adminReportLink', token, dutyId: id, date: '2026-10-01' }).data.code;
  const wrong = code === '1234' ? '5678' : '1234';
  for (let i = 0; i < 5; i++) assert.equal(env.post({ action: 'reportGet', dutyId: id, date: '2026-10-01', code: wrong }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'reportGet', dutyId: id, date: '2026-10-01', code }).error.code, 'BUSY');
});
