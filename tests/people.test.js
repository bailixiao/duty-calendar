// 管理後台：成員名單管理、分組管理。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  return { env, call };
}

test('成員：新增、修改、停用；重複姓名與不存在的組被擋；停用後名字提示不出現', () => {
  const { env, call } = setup();
  assert.equal(env.post({ action: 'adminMembers' }).error.code, 'UNAUTHORIZED');

  const add = call('adminSaveMember', { member: { name: ' 測試甲 ', identity: '道親', groups: { '打掃組': '第1組' } } });
  assert.equal(add.ok, true, JSON.stringify(add.error));
  let list = call('adminMembers').data;
  assert.equal(list.members.length, 1);
  assert.deepEqual(list.members[0], {
    row: 2, name: '測試甲', identity: '道親', note: '', active: true,
    groups: { '勤務了愿組': '', '打掃組': '第1組', '拜香輪值組': '' }
  });
  assert.ok(list.groups.length > 0);

  assert.equal(call('adminSaveMember', { member: { name: '測試甲' } }).error.code, 'VALIDATION');
  assert.match(call('adminSaveMember', { member: { name: '測試乙', groups: { '打掃組': '第9組' } } }).error.details[0].message, /沒有「第9組」/);
  assert.match(call('adminSaveMember', { member: { name: '測試乙', identity: '其他' } }).error.details[0].message, /身分/);

  // 核對原姓名，避免對錯列
  assert.equal(call('adminSaveMember', { row: 2, original: '別人', member: { name: '測試甲' } }).error.code, 'CONFLICT');

  const edit = call('adminSaveMember', { row: 2, original: '測試甲', member: { name: '測試甲', identity: '壇辦', groups: {}, active: false } });
  assert.equal(edit.ok, true, JSON.stringify(edit.error));
  list = call('adminMembers').data;
  assert.equal(list.members[0].active, false);
  assert.equal(list.members[0].identity, '壇辦');
  assert.deepEqual(env.get({ action: 'searchMembers', q: '測試' }).data.members, []);

  const logs = env.sheets['操作紀錄'].data.slice(-2).map((r) => r[1] + '｜' + r[3]);
  assert.deepEqual(logs, ['成員｜新增｜測試甲', '成員｜修改｜測試甲（停用）']);
});

test('分組：列表含電話與負責勤務數；新增；同類型重名被擋', () => {
  const { env, call } = setup();
  const list = call('adminGroups').data.groups;
  const clean1 = list.find((g) => g.type === '打掃組' && g.name === '第1組');
  assert.ok(clean1.duties > 0);
  assert.ok('phone' in clean1);

  const add = call('adminSaveGroup', { group: { type: '打掃組', name: '第6組', leader: '測試甲', members: '測試乙、測試丙\n測試丁', phone: '0900-000000' } });
  assert.equal(add.ok, true, JSON.stringify(add.error));
  const g6 = call('adminGroups').data.groups.find((g) => g.name === '第6組');
  assert.deepEqual(g6.members, ['測試乙', '測試丙', '測試丁']);
  assert.equal(g6.phone, '0900-000000');
  // 一般 API 仍不回傳電話
  assert.doesNotMatch(JSON.stringify(env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-12-31' })), /0900-000000/);

  assert.equal(call('adminSaveGroup', { group: { type: '打掃組', name: '第6組' } }).error.code, 'VALIDATION');
  assert.equal(call('adminSaveGroup', { group: { type: '其他', name: '甲' } }).error.code, 'VALIDATION');
});

test('分組改名：勤務的負責組與成員的組別一併更新；分組類型不能改', () => {
  const { env, call } = setup();
  call('adminSaveMember', { member: { name: '測試甲', groups: { '打掃組': '第1組' } } });
  const g = call('adminGroups').data.groups.find((x) => x.type === '打掃組' && x.name === '第1組');

  assert.equal(call('adminSaveGroup', { row: g.row, original: '第1組', group: { type: '勤務了愿組', name: '第1組' } }).error.code, 'BAD_REQUEST');

  const r = call('adminSaveGroup', { row: g.row, original: '第1組', group: Object.assign({}, g, { name: '第一組' }) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.renamed.duties, g.duties);
  assert.equal(r.data.renamed.members, 1);

  const duties = env.get({ action: 'getEvents', from: '2026-10-01', to: '2027-02-28' }).data.duties;
  assert.equal(duties.filter((d) => d.groupType === '打掃組' && d.group === '第1組').length, 0);
  assert.equal(duties.filter((d) => d.groupType === '打掃組' && d.group === '第一組').length, g.duties);
  // 勤務了愿組的第1組不受影響
  assert.ok(duties.some((d) => d.groupType === '勤務了愿組' && d.group === '第1組'));
  assert.equal(call('adminMembers').data.members[0].groups['打掃組'], '第一組');
});

test('刪除分組：有勤務負責不能刪；沒有就刪除並清空成員的組別', () => {
  const { call } = setup();
  const used = call('adminGroups').data.groups.find((x) => x.type === '打掃組' && x.name === '第1組');
  assert.equal(call('adminDeleteGroup', { row: used.row, original: used.name }).error.code, 'FORBIDDEN');

  call('adminSaveGroup', { group: { type: '打掃組', name: '第6組' } });
  call('adminSaveMember', { member: { name: '測試甲', groups: { '打掃組': '第6組' } } });
  const g6 = call('adminGroups').data.groups.find((x) => x.name === '第6組');
  const r = call('adminDeleteGroup', { row: g6.row, original: '第6組' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.clearedMembers, 1);
  assert.equal(call('adminGroups').data.groups.some((x) => x.name === '第6組'), false);
  assert.equal(call('adminMembers').data.members[0].groups['打掃組'], '');
});

test('從出勤紀錄加入成員：列出還不是成員的人、推斷身分、標出名字相近；加入時略過已存在', () => {
  const { call } = setup();
  call('adminSaveMember', { member: { name: '王小明', identity: '壇辦' } });
  call('adminImportHistory', { events: [
    { date: '2026-03-05', name: '打掃', tan: ['測試甲', '王小明'], dao: ['測試乙'], accompany: [] },
    { date: '2026-03-12', name: '打掃', tan: [], dao: ['測試甲', '測試乙'], unknown: ['小明'], accompany: [] }
  ] });
  const c = call('adminMemberCandidates').data.candidates;
  assert.deepEqual(c.map((x) => [x.name, x.count, x.identity]), [['測試乙', 2, '道親'], ['測試甲', 2, '壇辦'], ['小明', 1, '']]);
  assert.deepEqual(c.find((x) => x.name === '小明').similar, ['王小明']);
  assert.equal(c.find((x) => x.name === '測試甲').last, '2026-03-12');

  const r = call('adminAddMembers', { members: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '道親' }, { name: '王小明' }] });
  assert.deepEqual(r.data, { added: 2, skipped: 1 });
  const names = call('adminMembers').data.members.map((m) => m.name + '/' + m.identity + '/' + m.active);
  assert.deepEqual(names.sort(), ['測試乙/道親/true', '測試甲/壇辦/true', '王小明/壇辦/true'].sort());
  assert.deepEqual(call('adminMemberCandidates').data.candidates.map((x) => x.name), ['小明']);
});
