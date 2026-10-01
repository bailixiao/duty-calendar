// 出席修正。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const volunteer = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  return { env, call, duty: volunteer, pid: volunteer.positions[0].id };
}

test('改未到、改陪同：寫回報名分頁、名單看得到、寫入修正紀錄；只有壇辦能陪同', () => {
  const { env, call, duty, pid } = setup();
  const s = env.post({ action: 'signup', dutyId: duty.id, positionId: pid, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '道親' }] });
  const [a, b] = s.data.created;

  assert.equal(call('adminDuty', { id: duty.id }).data.signups.find((x) => x.id === a.id).attend, '出席', '預設出席');

  const r = call('adminSetAttendance', { signupId: a.id, attend: '未到' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(call('adminDuty', { id: duty.id }).data.signups.find((x) => x.id === a.id).attend, '未到');

  assert.equal(call('adminSetAttendance', { signupId: a.id, accompany: true }).data.accompany, true);
  assert.equal(call('adminSetAttendance', { signupId: b.id, accompany: true }).error.code, 'BAD_REQUEST');
  assert.equal(call('adminSetAttendance', { signupId: a.id, attend: '請假' }).error.code, 'BAD_REQUEST');
  assert.equal(env.post({ action: 'adminSetAttendance', signupId: a.id, attend: '出席' }).error.code, 'UNAUTHORIZED');

  const logs = env.sheets['操作紀錄'].data.slice(-2);
  assert.deepEqual(logs.map((l) => l[1]), ['修正', '修正']);
  assert.match(logs[0][3], /測試甲.*改為未到/);
  assert.match(logs[1][3], /改為陪同/);
  assert.match(logs[0][4], /"出席":"出席"/, '留前一版資料');
});

test('補登：不受日期限制、記為出席；名額或重複只警告；資料錯誤要擋', () => {
  const env0 = setup();
  const { env, call, duty, pid } = env0;
  // 10/13 志工最多 2 人，先報滿
  env.post({ action: 'signup', dutyId: duty.id, positionId: pid, dates: ['2026-10-13'], entries: [{ name: '測試甲' }, { name: '測試乙' }] });
  env.clock.now = Date.UTC(2026, 9, 14, 2); // 勤務已過去

  const r = call('adminAddAttendee', { dutyId: duty.id, positionId: pid, date: '2026-10-13', name: '測試丙', identity: '道親' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(r.data.warnings.join(), /額滿/);
  const added = call('adminDuty', { id: duty.id }).data.signups.find((x) => x.name === '測試丙');
  assert.equal(added.attend, '出席');
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /補登（警告/);

  assert.equal(call('adminAddAttendee', { dutyId: duty.id, positionId: pid, date: '2026-10-13', name: '測試丁' }).error.code, 'VALIDATION', '沒選身分');
  assert.equal(call('adminAddAttendee', { dutyId: duty.id, positionId: pid, date: '2026-10-20', name: '測試丁', identity: '道親' }).error.code, 'VALIDATION', '日期不在勤務期間');
  assert.equal(call('adminAddAttendee', { dutyId: 'X', positionId: pid, date: '2026-10-13', name: '測試丁', identity: '道親' }).error.code, 'VALIDATION');
});
