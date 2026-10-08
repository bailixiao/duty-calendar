// 匯入出勤名單（apps-script/Attendance.gs adminImportAttendance_）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('匯入出勤名單：補登到已有的場次、沒有的場次自動新增；重複匯入跳過；沒身分可以匯入、身分寫錯擋下；類別帳號只能匯入自己類別', () => {
  const env = createEnv(Date.UTC(2026, 9, 6, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const sessions = [
    { dutyId: ev.id, date: '2026-10-13', entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '壇辦', note: '未滿15歲' }] },
    { create: { name: '研究班（測試）', category: '道務', nature: '課程', startTime: '09:00', location: '區中心' }, date: '2026-05-16', entries: [{ name: '王小明', identity: '道親' }] }
  ];
  const r = env.post({ action: 'adminImportAttendance', token, sessions });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.results.map((x) => x.added), [2, 1]);
  const again = env.post({ action: 'adminImportAttendance', token, sessions });
  assert.deepEqual(again.data.results.map((x) => [x.added, x.skipped.length]), [[0, 2], [0, 1]], '重複匯入跳過、不會再新增場次');
  const duty = env.post({ action: 'adminDuty', token, id: again.data.results[1].dutyId }).data;
  assert.equal(duty.category, '道務');
  // 沒身分的也可以匯入（身分留空，統計時用成員名單上的身分）；身分寫錯才擋
  assert.equal(env.post({ action: 'adminImportAttendance', token, sessions: [{ dutyId: ev.id, date: '2026-10-13', entries: [{ name: '測試丙' }] }] }).ok, true);
  assert.equal(env.post({ action: 'adminImportAttendance', token, sessions: [{ dutyId: ev.id, date: '2026-10-13', entries: [{ name: '測試丁', identity: '外星人' }] }] }).error.code, 'VALIDATION');
  env.post({ action: 'adminSaveAccount', token, account: { account: '道務組', role: '道務', password: 'abc12345' } });
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminImportAttendance', token: dw, sessions: [sessions[0]] }).error.code, 'FORBIDDEN', '道務帳號不能匯入勤務的場次');
});

test('一格好幾個名字：報名擋下；後台可以拆成多人', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ev = env.get({ action: 'getEvents', from: '2026-10-10', to: '2026-10-10' }).data.duties.find((d) => d.mode !== '公告型' && d.positions[0].max === null || (d.mode !== '公告型' && (d.positions[0].max || 0) >= 4));
  const base = { action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-10'] };
  const bad = env.post(Object.assign({}, base, { entries: [{ name: '測試甲.測試乙.測試丙', identity: '道親' }] }));
  assert.equal(bad.error.code, 'VALIDATION');
  assert.match(bad.error.details[0].message, /好幾個名字/);
  assert.equal(env.post(Object.assign({}, base, { entries: [{ name: '測試甲 測試乙', identity: '道親' }] })).error.code, 'VALIDATION', '中文名字用空白隔開也擋');
  // 舊資料：直接寫進去一筆（模擬以前報成一筆的），後台拆開
  const r = env.post({ action: 'adminImportAttendance', token, sessions: [{ dutyId: ev.id, date: '2026-10-10', entries: [{ name: '測試甲', identity: '道親' }] }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const sheet = env.sheets['報名'].data;
  const h = sheet[0];
  const row = sheet.find((x, i) => i && x[h.indexOf('姓名')] === '測試甲');
  row[h.indexOf('姓名')] = '測試甲.測試乙、測試丙';
  env.fn('invalidateTable_')(env.fn('SHEETS').SIGNUPS);
  const id = row[h.indexOf('報名ID')];
  const split = env.post({ action: 'adminSplitSignup', token, signupId: id });
  assert.equal(split.ok, true, JSON.stringify(split.error));
  assert.deepEqual(split.data.names, ['測試甲', '測試乙', '測試丙']);
  const names = env.get({ action: 'getDuty', id: ev.id }).data.signups.filter((s) => s.date === '2026-10-10').map((s) => s.name).sort();
  assert.deepEqual(names, ['測試丙', '測試乙', '測試甲']);
});
