// 組員備註（apps-script/GroupNote.gs）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('組員備註：負責組的家人可以留、大家看得到、只能刪自己的；不是這組的不行', () => {
  const env = createEnv(OCT_1);
  env.sheets['成員'].data.push(['測試甲', '道親', '', '第1組', '', '', '是'], ['測試乙', '道親', '', '第2組', '', '', '是']);
  env.onEdit();
  const v = env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-10-31' }).data.duties
    .find((d) => d.groupType === '打掃組' && d.group === '第1組' && d.start >= '2026-10-02');
  assert.ok(v, '測試資料要有第1組負責的勤務');
  assert.deepEqual(env.get({ action: 'getDuty', id: v.id }).data.groupNotes, []);

  const r = env.post({ action: 'groupNote', dutyId: v.id, date: v.start, name: '測試 甲', note: '這天有事，想改到下個月' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.notes.map((n) => [n.name, n.date, n.note]), [['測試甲', v.start, '這天有事，想改到下個月']]);
  const d = env.get({ action: 'getDuty', id: v.id }).data;
  assert.equal(d.groupNotes.length, 1);
  assert.ok(!JSON.stringify(d.groupNotes).includes('time'), '不回傳留言時間以外的資料也沒關係，但不要有多的欄位');

  assert.equal(env.post({ action: 'groupNote', dutyId: v.id, date: v.start, name: '測試乙', note: '我也想改' }).error.code, 'FORBIDDEN', '不是第1組');
  assert.equal(env.post({ action: 'groupNote', dutyId: v.id, date: '2026-12-31', name: '測試甲', note: '日期不對' }).error.code, 'VALIDATION');
  assert.equal(env.post({ action: 'groupNote', dutyId: v.id, date: v.start, name: '測試甲', note: '' }).error.code, 'VALIDATION');

  const id = d.groupNotes[0].id;
  assert.equal(env.post({ action: 'groupNoteDelete', dutyId: v.id, id, name: '測試乙' }).error.code, 'FORBIDDEN');
  const del = env.post({ action: 'groupNoteDelete', dutyId: v.id, id, name: '測試甲' });
  assert.equal(del.ok, true, JSON.stringify(del.error));
  assert.deepEqual(del.data.notes, []);
  assert.ok(env.sheets['操作紀錄'].data.some((row) => row[1] === '組員備註'));
});

test('組員備註：後台改勤務不會把備註洗掉', () => {
  const env = createEnv(OCT_1);
  env.sheets['成員'].data.push(['測試甲', '道親', '', '第1組', '', '', '是']);
  env.onEdit();
  const v = env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-10-31' }).data.duties
    .find((d) => d.groupType === '打掃組' && d.group === '第1組' && d.start >= '2026-10-02');
  env.post({ action: 'groupNote', dutyId: v.id, date: v.start, name: '測試甲', note: '想改日期' });
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const edit = env.post({ action: 'adminDutyForEdit', token, id: v.id }).data;
  const up = env.post({ action: 'adminUpdateDuty', token, id: v.id, duty: Object.assign({}, edit.duty, { attire: '白上衣' }) });
  assert.equal(up.ok, true, JSON.stringify(up.error));
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.groupNotes.length, 1);
});

test('分組：近一年負責過幾筆勤務、之後還有幾筆', () => {
  const env = createEnv(Date.UTC(2026, 10, 20, 2)); // 台北 11/20
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const groups = env.post({ action: 'adminGroups', token }).data.groups;
  const g = groups.find((x) => x.type === '打掃組' && x.name === '第1組');
  assert.deepEqual(g.year.map((x) => x.date), ['2026-10-10'], '只算今天以前、一年內的');
  assert.equal(g.upcoming, g.duties - g.year.length, '其他都是之後的');
  assert.ok(g.upcoming > 0);
  assert.ok(g.year.every((x, i, a) => !i || a[i - 1].date >= x.date), '新的排前面');
});

test('改了分組的組長，勤務資料馬上看到新的組長（同一份程式連續處理好幾個請求）', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const find = () => env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-10-31' }).data.duties.find((d) => d.groupType === '打掃組' && d.group === '第1組');
  const before = find().groupLeader;
  const g = env.post({ action: 'adminGroups', token }).data.groups.find((x) => x.type === '打掃組' && x.name === '第1組');
  const r = env.post({ action: 'adminSaveGroup', token, row: g.row, original: g.name, group: { type: g.type, name: g.name, leader: '測試新組長', assistant: '', members: [], phone: '' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.notEqual(before, '測試新組長');
  assert.equal(find().groupLeader, '測試新組長');
});
