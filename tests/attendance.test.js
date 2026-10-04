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

test('職司表：版面、階段存得進去；組長 ★、註記寫回報名，家人們的名單看得到', () => {
  const { env, call } = setup();
  const c = call('adminCreateDuties', { duties: [{ name: '小組輪值', start: '2026-10-20', end: '2026-10-22', layout: '職司表', stages: '即日起~10/10｜報名\n10/20~10/22｜輪值', positions: [{ name: '烹飪', max: '' }, { name: '維安' }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const id = c.data.ids[0];
  let d = env.get({ action: 'getDuty', id }).data;
  assert.equal(d.layout, '職司表');
  assert.equal(d.stages, '即日起~10/10｜報名\n10/20~10/22｜輪值');
  assert.equal(call('adminCreateDuties', { duties: [{ name: 'x', start: '2026-10-20', layout: '亂寫', positions: [{ name: 'a' }] }] }).error.code, 'VALIDATION');
  const s = env.post({ action: 'signup', dutyId: id, positionId: d.positions[0].id, dates: ['2026-10-20', '2026-10-21'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  const sid = s.data.created[0].id;
  assert.equal(call('adminSetAttendance', { signupId: sid, leader: true, note: '前一天晚上到' }).ok, true);
  assert.equal(call('adminSetAttendance', { signupId: sid, note: 'x'.repeat(101) }).error.code, 'BAD_REQUEST');
  d = env.get({ action: 'getDuty', id }).data;
  const mine = d.signups.find((x) => x.id === sid);
  assert.equal(mine.leader, true);
  assert.equal(mine.note, '前一天晚上到');
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /設為組長.*註記：前一天晚上到/);
  assert.equal(call('adminSetAttendance', { signupId: sid, leader: false, note: '' }).ok, true);
  // 報名時自己寫的註記（職司表才收）
  const s2 = env.post({ action: 'signup', dutyId: id, positionId: d.positions[1].id, dates: ['2026-10-22'], entries: [{ name: '測試乙', identity: '道親', note: '8:00-19:00' }] });
  assert.equal(s2.ok, true, JSON.stringify(s2.error));
  assert.equal(env.get({ action: 'getDuty', id }).data.signups.find((x) => x.id === s2.data.created[0].id).note, '8:00-19:00');
  const after = env.get({ action: 'getDuty', id }).data.signups.find((x) => x.id === sid);
  assert.deepEqual([after.leader, after.note], [false, '']);
});

test('管理者幫人報名：未來的日期也可以加（不受截止日限制），操作紀錄寫「管理者幫人報名」', () => {
  const { env, call, duty, pid } = setup();
  const r = call('adminAddAttendee', { dutyId: duty.id, positionId: pid, date: '2026-10-13', name: '測試甲', identity: '道親' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(env.get({ action: 'getDuty', id: duty.id }).data.signups.some((s) => s.name === '測試甲' && s.date === '2026-10-13'));
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /管理者幫人報名/);
});
