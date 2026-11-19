// 負責組可以好幾組（2026/11/19）：存成「第1組、第3組、第5組」。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const groups = env.sheets['分組'].data;
  const set = (name, leader, phone) => { const g = groups.find((r) => r[0] === '勤務了愿組' && r[1] === name); g[2] = leader; g[5] = phone; };
  set('第1組', '測試甲', '0900-000-001');
  set('第3組', '測試乙', '0900-000-003');
  return { env, call };
}

const duty = (group) => ({ name: '測試打掃', category: '勤務', start: '2026-11-20', end: '2026-11-20', groupType: '勤務了愿組', group, positions: [{ name: '打掃' }] });

test('好幾組：可以存、每一組都要存在；組長、電話每組一筆；家人們看到組長（沒有電話）', () => {
  const { env, call } = setup();
  const bad = call('adminCreateDuties', { duties: [duty('第1組、第99組')] });
  assert.equal(bad.ok, false);
  assert.match(JSON.stringify(bad.error), /沒有「第99組」/);

  const made = call('adminCreateDuties', { duties: [duty('第1組、第3組')] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const d = env.get({ action: 'getEvents', from: '2026-11-20', to: '2026-11-20' }).data.duties.find((x) => x.name === '測試打掃');
  assert.equal(d.group, '第1組、第3組');
  assert.equal(d.groupLeader, '測試甲、測試乙');
  assert.ok(!JSON.stringify(d).includes('0900'));

  const a = call('adminDuty', { id: d.id }).data;
  assert.deepEqual(a.groupContact, [
    { name: '第1組', leader: '測試甲', phone: '0900-000-001' },
    { name: '第3組', leader: '測試乙', phone: '0900-000-003' }
  ]);

  // 分組頁的負責次數：兩組各算一次
  const gs = call('adminGroups').data.groups.filter((x) => x.type === '勤務了愿組');
  const before = (n) => gs.find((x) => x.name === n).upcoming;
  assert.ok(before('第1組') >= 1 && before('第3組') >= 1);
});

test('好幾組：改組名只換掉那一組；其中一組還在負責就不能刪', () => {
  const { env, call } = setup();
  call('adminCreateDuties', { duties: [duty('第1組、第3組')] });
  const g3 = call('adminGroups').data.groups.find((x) => x.type === '勤務了愿組' && x.name === '第3組');
  const r = call('adminSaveGroup', { row: g3.row, original: '第3組', group: Object.assign({}, g3, { name: '第三組' }) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const d = env.get({ action: 'getEvents', from: '2026-11-20', to: '2026-11-20' }).data.duties.find((x) => x.name === '測試打掃');
  assert.equal(d.group, '第1組、第三組');

  const g = call('adminGroups').data.groups.find((x) => x.type === '勤務了愿組' && x.name === '第三組');
  assert.equal(call('adminDeleteGroup', { row: g.row, original: '第三組' }).error.code, 'FORBIDDEN');
  // 組名不能有「、」
  assert.equal(call('adminSaveGroup', { group: { type: '打掃組', name: '甲、乙' } }).error.code, 'VALIDATION');
});

test('建議負責組：好幾組的勤務，每一組都算負責一次', () => {
  global.window = {};
  require('../js/format.js');
  global.Fmt = global.window.Fmt;
  const G = require('../js/group-fair.js');
  const duties = [{ id: 'a', group: '第1組、第3組', start: '2026-11-10', end: '2026-11-10', groupType: '勤務了愿組' }];
  const r = G.rank(['第1組', '第2組', '第3組'], '勤務了愿組', duties, '2026-11-10', '', '2026-11-02');
  assert.deepEqual(r.map((x) => [x.name, x.count, x.busy]), [['第2組', 0, false], ['第1組', 1, true], ['第3組', 1, true]]);
  assert.deepEqual(global.Fmt.groupNames('第1組、 第3組、'), ['第1組', '第3組']);
});

test('批次匯入：負責組可以寫好幾組（「、」隔開）', () => {
  const P = require('../js/import-parse.js');
  const groups = [{ type: '打掃組', name: '第1組' }, { type: '打掃組', name: '第3組' }, { type: '勤務了愿組', name: '第1組' }, { type: '勤務了愿組', name: '第3組' }];
  assert.deepEqual(P.parseGroup('打掃組 第1組、第3組', groups), { groupType: '打掃組', group: '第1組、第3組' });
  assert.match(P.parseGroup('打掃組 第1組、第9組', groups).error, /沒有「第9組」/);
  assert.match(P.parseGroup('打掃組 第1組、勤務了愿組 第3組', groups).error, /同一種分組/);
});
