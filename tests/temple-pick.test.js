// 報名先選佛堂（勤務「報名選佛堂」、公開 API templeMembers、報名檢查佛堂）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('報名選佛堂：勾了才能列佛堂家人；每位都要有佛堂；記下佛堂', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const admin = (action, body) => env.post(Object.assign({ action, token: sup }, body));
  assert.equal(admin('adminSaveMember', { member: { name: '測試甲', identity: '道親', temple: '測試佛堂A' } }).ok, true);
  assert.equal(admin('adminSaveMember', { member: { name: '測試乙', identity: '壇辦', temple: '測試佛堂A' } }).ok, true);
  assert.equal(admin('adminSaveMember', { member: { name: '測試丙', identity: '道親', temple: '測試佛堂B' } }).ok, true);

  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  assert.equal(ev.templePick, false);
  assert.equal(env.get({ action: 'templeMembers', dutyId: ev.id, temple: '測試佛堂A' }).error.code, 'BAD_REQUEST', '沒勾不能用');

  const edit = admin('adminDutyForEdit', { id: ev.id }).data.duty;
  const saved = admin('adminUpdateDuty', { id: ev.id, duty: Object.assign({}, edit, { templePick: true }) });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.equal(admin('adminDutyForEdit', { id: ev.id }).data.duty.templePick, '是');
  const duty = env.get({ action: 'getDuty', id: ev.id }).data;
  assert.equal(duty.templePick, true);

  const list = env.get({ action: 'templeMembers', dutyId: ev.id, temple: '測試佛堂A' }).data;
  assert.ok(list.temples.indexOf('測試佛堂A') !== -1 && list.temples.indexOf('測試佛堂B') !== -1);
  assert.deepEqual(list.members, [{ name: '測試乙', identity: '壇辦' }, { name: '測試甲', identity: '道親' }].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')));
  assert.ok(list.members.every((m) => Object.keys(m).join() === 'name,identity'), '只回名字和身分');
  assert.deepEqual(env.get({ action: 'templeMembers', dutyId: ev.id }).data.members, [], '沒給佛堂只回清單');

  const pid = ev.positions[0].id;
  const bad = env.post({ action: 'signup', dutyId: ev.id, positionId: pid, dates: ['2026-10-13'], entries: [{ name: '測試丁', identity: '道親' }] });
  assert.equal(bad.error.code, 'BAD_REQUEST');
  assert.match(bad.error.message, /測試丁/);
  const ok = env.post({ action: 'signup', dutyId: ev.id, positionId: pid, dates: ['2026-10-13'], entries: [{ name: '測試甲', temple: '測試佛堂A' }, { name: '測試丁', identity: '道親', temple: '測試佛堂B' }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const rows = admin('adminDuty', { id: ev.id }).data.signups.map((s) => [s.name, s.temple]).sort();
  assert.deepEqual(rows, [['測試丁', '測試佛堂B'], ['測試甲', '測試佛堂A']]);
});
