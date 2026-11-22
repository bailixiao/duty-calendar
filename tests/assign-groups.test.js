// 依名單設定組別（2026/11/22）
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('依名單設定組別：佛堂整個設、名字優先、第一組＝第1組、先預覽再設定', () => {
  const env = createEnv(Date.UTC(2026, 10, 22, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  ['第1組', '第2組'].forEach((name) => call('adminSaveGroup', { group: { type: '打掃組', name, leader: '', assistant: '', members: '', phone: '' } }));
  call('adminSaveMember', { member: { name: '測試甲', temple: '測試甲佛堂', groups: {} } });
  call('adminSaveMember', { member: { name: '測試乙', temple: '測試甲佛堂', groups: {} } });
  call('adminSaveMember', { member: { name: '測試丙', temple: '測試丙', groups: {} } });
  const items = [{ group: '第一組', temples: ['測試甲佛堂'], names: [] }, { group: '第二組', names: ['測試乙', '不在名單'], temples: ['測試丙佛堂', '沒有的佛堂'] }];
  const pre = call('adminAssignGroups', { type: '打掃組', items });
  assert.equal(pre.ok, true, JSON.stringify(pre.error));
  const to = Object.fromEntries(pre.data.changes.map((c) => [c.name, c.to]));
  assert.deepEqual(to, { 測試甲: '第1組', 測試乙: '第2組', 測試丙: '第2組' }, '名字比佛堂優先；佛堂寫法有沒有「佛堂」都對得到');
  assert.deepEqual([pre.data.unknownNames, pre.data.unknownTemples], [['不在名單'], ['沒有的']]);
  const m0 = call('adminMembers').data.members.find((m) => m.name === '測試甲');
  assert.equal(m0.groups['打掃組'], '', '預覽不會改');
  const r = call('adminAssignGroups', { type: '打掃組', items, apply: true });
  assert.equal(r.data.changes.length, 3);
  const ms = call('adminMembers').data.members;
  assert.equal(ms.find((m) => m.name === '測試乙').groups['打掃組'], '第2組');
  assert.equal(call('adminAssignGroups', { type: '打掃組', items: [{ group: '第9組', names: ['測試甲'] }] }).error.code, 'VALIDATION', '沒有的組會擋');
  const clear = call('adminAssignGroups', { type: '打掃組', items: [{ group: '第1組', names: ['測試甲'] }], clearOthers: true });
  assert.deepEqual(clear.data.changes.map((c) => [c.name, c.to]).sort(), [['測試丙', ''], ['測試乙', '']], '名單上沒有的清掉');
});
