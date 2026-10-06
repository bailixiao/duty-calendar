// 匯入出勤名單（apps-script/Attendance.gs adminImportAttendance_）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('匯入出勤名單：補登到已有的場次、沒有的場次自動新增；重複匯入跳過；沒身分擋下；類別帳號只能匯入自己類別', () => {
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
  assert.equal(env.post({ action: 'adminImportAttendance', token, sessions: [{ dutyId: ev.id, date: '2026-10-13', entries: [{ name: '測試丙' }] }] }).error.code, 'VALIDATION');
  env.post({ action: 'adminSaveAccount', token, account: { account: '道務組', role: '道務', password: 'abc12345' } });
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminImportAttendance', token: dw, sessions: [sessions[0]] }).error.code, 'FORBIDDEN', '道務帳號不能匯入勤務的場次');
});
