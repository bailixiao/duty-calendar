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
  assert.match(env.post(Object.assign({ action: 'reportGet' }, p)).error.message, /期限/);
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

test('活動回報（預設）：報名名單上的人用名字填，每人一份、再填是修改；不在名單上不能填；公告型成員都能填', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0)); // 10/1
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const admin = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(admin('adminSaveMember', { member: { name: '測試丙', identity: '道親' } }).ok, true);
  const made = admin('adminCreateDuties', { duties: [
    { name: '測試淨灘', category: '勤務', nature: '活動', mode: '報名型', start: '2026-10-03', end: '2026-10-04', positions: [{ name: '參加', min: 0, max: null }] },
    { name: '測試公告', category: '勤務', nature: '活動', mode: '公告型', start: '2026-10-03' }
  ] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const [id, notice] = made.data.ids;
  const pid = env.get({ action: 'getDuty', id }).data.positions[0].id;
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-03'], entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '道親' }] }).ok, true);

  assert.match(env.post({ action: 'reportGet', dutyId: id, date: '2026-10-03', name: '測試甲' }).error.message, /起才能回報/);
  env.clock.now = Date.UTC(2026, 9, 4, 10, 0, 0); // 10/4 晚上
  const g = env.post({ action: 'reportGet', dutyId: id, date: '2026-10-03', name: '測試甲' });
  assert.equal(g.ok, true, JSON.stringify(g.error));
  assert.deepEqual(g.data.dates, ['2026-10-04', '2026-10-03'], '能回報的日期，新的在前');
  assert.equal(g.data.report.updatedAt, '');
  assert.match(env.post({ action: 'reportGet', dutyId: id, date: '2026-10-03', name: '測試丁' }).error.message, /找不到「測試丁」/);
  assert.equal(env.post({ action: 'reportSave', dutyId: id, date: '2026-10-03', name: '測試丁', overall: '好' }).error.code, 'FORBIDDEN');

  assert.equal(env.post({ action: 'reportSave', dutyId: id, date: '2026-10-03', name: '測試甲', overall: '順利' }).ok, true);
  assert.equal(env.post({ action: 'reportSave', dutyId: id, date: '2026-10-03', name: '測試乙', problems: '垃圾袋不夠' }).ok, true);
  const again = env.post({ action: 'reportSave', dutyId: id, date: '2026-10-03', name: '測試甲', overall: '順利，提早結束' });
  assert.equal(again.data.report.overall, '順利，提早結束');
  assert.equal(env.post({ action: 'reportGet', dutyId: id, date: '2026-10-03', name: '測試甲' }).data.report.overall, '順利，提早結束', '再打開帶出自己那份');
  const reps = admin('adminDuty', { id }).data.reports;
  assert.deepEqual(reps.map((r) => [r.name, r.overall || r.problems]).sort(), [['測試乙', '垃圾袋不夠'], ['測試甲', '順利，提早結束']]);

  // 回報碼那份和名字那份分開
  const code = admin('adminReportLink', { dutyId: id, date: '2026-10-03' }).data.code;
  assert.equal(env.post({ action: 'reportSave', dutyId: id, date: '2026-10-03', code, name: '測試丁', improve: '多帶手套' }).ok, true);
  assert.equal(admin('adminDuty', { id }).data.reports.length, 3);

  assert.equal(env.post({ action: 'reportSave', dutyId: notice, date: '2026-10-03', name: '測試丙', overall: '公告型也能填' }).ok, true, '公告型：成員名單上的人');
  assert.equal(env.post({ action: 'reportSave', dutyId: notice, date: '2026-10-03', name: '測試丁', overall: 'x' }).error.code, 'FORBIDDEN');
});
