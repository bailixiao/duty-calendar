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

test('登記張數：報名填張數、名單回傳張數、管理者可改；面額存在勤務上', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const admin = (action, body) => env.post(Object.assign({ action, token: sup }, body));
  const made = admin('adminCreateDuties', { duties: [{ name: '測試園遊券', category: '勤務', nature: '活動', mode: '報名型', start: '2026-12-06', positions: [{ name: '參加', min: 0, max: null }], tickets: true, price: '100' }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const id = made.data.ids[0];
  const duty = env.get({ action: 'getDuty', id }).data;
  assert.deepEqual([duty.tickets, duty.price], [true, 100]);
  assert.equal(admin('adminCreateDuties', { duties: [{ name: '測試園遊券二', category: '勤務', nature: '活動', mode: '報名型', start: '2026-12-06', positions: [{ name: '參加', min: 0, max: null }], tickets: true, price: '一百' }] }).error.code, 'VALIDATION');

  const pid = duty.positions[0].id;
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-12-06'], entries: [{ name: '測試甲', identity: '道親', tickets: 0 }] }).error.code, 'BAD_REQUEST');
  const ok = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-12-06'], entries: [{ name: '測試甲', identity: '道親', tickets: 3 }, { name: '測試乙', identity: '道親' }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const rows = () => env.get({ action: 'getDuty', id }).data.signups.map((s) => [s.name, s.tickets]).sort();
  assert.deepEqual(rows(), [['測試乙', 1], ['測試甲', 3]], '沒填算 1 張');

  const sid = env.get({ action: 'getDuty', id }).data.signups.find((s) => s.name === '測試乙').id;
  assert.equal(admin('adminSetAttendance', { signupId: sid, tickets: 5 }).ok, true);
  assert.equal(admin('adminSetAttendance', { signupId: sid, tickets: 1000 }).error.code, 'BAD_REQUEST');
  assert.deepEqual(rows(), [['測試乙', 5], ['測試甲', 3]]);
  const edit = admin('adminDutyForEdit', { id }).data.duty;
  assert.deepEqual([edit.tickets, edit.price], ['是', '100']);

  // 同一人再登記一次：張數加上去，不算重複
  const again = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-12-06'], entries: [{ name: '測試甲', identity: '道親', tickets: 2 }, { name: '測試丙', identity: '道親', tickets: 1 }] });
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.deepEqual(again.data.added.map((a) => [a.name, a.added, a.tickets]), [['測試甲', 2, 5]]);
  assert.deepEqual(again.data.created.map((c) => c.name), ['測試丙']);
  assert.deepEqual(rows(), [['測試丙', 1], ['測試乙', 5], ['測試甲', 5]]);
  const logs = admin('adminLogs', { offset: 0, limit: 5 }).data.logs;
  assert.ok(logs.some((l) => l.action === '加張數'));
});

test('分批截止日：依報名時間分批；第 2 批再加張數另列一行；最後一批過了就截止；給分壇名單分批列', () => {
  const env = createEnv(Date.UTC(2026, 10, 3, 2, 0, 0)); // 2026-11-03
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const admin = (action, body) => env.post(Object.assign({ action, token: sup }, body));
  const made = admin('adminCreateDuties', { duties: [{ name: '測試分批券', category: '勤務', nature: '活動', mode: '報名型', start: '2026-11-20', positions: [{ name: '參加', min: 0, max: null }], tickets: true, price: '100', batches: ['2026-11-10', '2026-11-06'] }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const id = made.data.ids[0];
  const duty = env.get({ action: 'getDuty', id }).data;
  assert.deepEqual([duty.batches, duty.deadline], [['2026-11-06', '2026-11-10'], '2026-11-10'], '排好順序，最後一批就是報名截止日');
  assert.deepEqual(admin('adminDutyForEdit', { id }).data.duty.batches, ['2026-11-06', '2026-11-10']);
  const pid = duty.positions[0].id;
  const sign = (entries) => env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-11-20'], entries });
  assert.equal(sign([{ name: '測試甲', identity: '道親', temple: '測試佛堂A', tickets: 3 }]).ok, true);
  assert.deepEqual(sign([{ name: '測試甲', identity: '道親', temple: '測試佛堂A', tickets: 1 }]).data.added.map((a) => a.tickets), [4], '同一批：加到原本那行');
  env.clock.now = Date.UTC(2026, 10, 8, 2, 0, 0); // 11/8：第 2 批
  const b2 = sign([{ name: '測試甲', identity: '道親', temple: '測試佛堂A', tickets: 2 }, { name: '測試乙', identity: '道親', temple: '測試佛堂B', tickets: 1 }]);
  assert.equal(b2.ok, true, JSON.stringify(b2.error));
  assert.deepEqual([b2.data.created.length, b2.data.added.length], [2, 0], '第 2 批另列一行');
  assert.deepEqual(sign([{ name: '測試甲', identity: '道親', temple: '測試佛堂A', tickets: 1 }]).data.added.map((a) => a.tickets), [3], '第 2 批再加：加到第 2 批那行');
  const rows = env.get({ action: 'getDuty', id }).data.signups.map((s) => [s.name, s.tickets, s.batch]).sort();
  assert.deepEqual(rows, [['測試乙', 1, 1], ['測試甲', 3, 1], ['測試甲', 4, 0]]);
  const roster = admin('adminRoster', {}).data.days.find((d) => d.date === '2026-11-20').duties.find((x) => x.id === id);
  assert.deepEqual(roster.batches, ['2026-11-06', '2026-11-10']);
  assert.deepEqual(roster.items.map((it) => [it.name, it.tickets, it.batch]), [['測試甲', 4, 0], ['測試甲', 3, 1], ['測試乙', 1, 1]]);
  // 給分壇名單的文字：各批分開，各批有小計，最後寫總共
  const prevFmt = global.Fmt;
  global.Fmt = { shortDate: (d) => d, esc: (v) => v, addDays: (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10) };
  if (!global.window || !global.window.AdminPages) { global.window = { SITE: { org: '教全區' } }; require('../js/admin-pages.js'); }
  const P = global.window.AdminPages;
  assert.equal(P.rosterText(P.byDuty([{ date: '2026-11-20', duties: [roster] }])),
    ['教全區', '【測試分批券】', '2026-11-20',
      '第1批（～11/6）', '測試佛堂A', '測試甲 4張', '小計 4 張・400 元', '第1批共 4 張・400 元',
      '第2批（11/7～11/10）', '測試佛堂A', '測試甲 3張', '小計 3 張・300 元', '測試佛堂B', '測試乙 1張', '小計 1 張・100 元', '第2批共 4 張・400 元',
      '共 8 張・800 元'].join('\n'));
  global.Fmt = prevFmt;
  env.clock.now = Date.UTC(2026, 10, 11, 2, 0, 0); // 11/11：都截止了
  assert.equal(sign([{ name: '測試丙', identity: '道親', temple: '測試佛堂B', tickets: 1 }]).ok, false);
});
