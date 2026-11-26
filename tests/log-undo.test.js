// 操作紀錄的還原與「刪掉」（apps-script/LogUndo.gs，2026/11/26）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup(now) {
  const env = createEnv(now || OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const log = (re) => call('adminLogs', { offset: 0, limit: 50 }).data.logs.find((l) => re.test(l.summary) && !l.restoredAt && l.action !== '還原');
  const undo = (l) => call('adminRestore', { row: l.row, signupId: l.signupId });
  return { env, call, log, undo };
}

function duty(overrides) {
  return Object.assign({
    name: '測試勤務', nature: '勤務', mode: '報名型', start: '2026-12-01', end: '',
    startTime: '8:00', endTime: '12:00', location: '宏宗', positions: [{ name: '志工', min: '', max: '2' }]
  }, overrides);
}

test('新增勤務可以「刪掉」；有別人報名就不能刪；刪掉後的紀錄不能再按', () => {
  const { env, call, log, undo } = setup();
  const id = call('adminCreateDuties', { duties: [duty({ name: '測試刪掉' })] }).data.ids[0];
  const l = log(/測試刪掉/);
  assert.equal(l.action, '新增勤務');
  assert.equal(l.undoLabel, '刪掉');
  const pos = call('adminDutyForEdit', { id }).data.duty.positions[0];
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: pos.id, dates: ['2026-12-01'], entries: [{ name: '測試甲' }] }).ok, true);
  assert.equal(undo(l).error.code, 'FORBIDDEN');
  const sid = call('adminDuty', { id }).data.signups[0].id;
  call('adminCancel', { signupId: sid });
  const r = undo(l);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(call('adminDutyForEdit', { id }).error.code, 'NOT_FOUND');
  assert.equal(undo(l).error.code, 'ALREADY');
  const after = call('adminLogs', { offset: 0, limit: 5 }).data.logs;
  assert.match(after[0].summary, /^從紀錄刪掉「新增勤務」/);
  assert.equal(after[0].restorable, false, '「還原」這筆本身不能再還原');
});

test('刪除勤務、修改勤務（含了愿項目、單日活動改日期）、放到首頁、搬日期都可以還原', () => {
  const { env, call, log, undo } = setup();
  const id = call('adminCreateDuties', { duties: [duty({ name: '測試修改', positions: [{ name: '烹飪', max: '4' }, { name: '清潔' }] })] }).data.ids[0];
  const edit = call('adminDutyForEdit', { id }).data.duty;
  const [cook, clean] = edit.positions;
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: cook.id, dates: ['2026-12-01'], entries: [{ name: '測試甲' }] }).ok, true);
  // 改地點、拿掉清潔、加交通
  assert.equal(call('adminUpdateDuty', { id, duty: Object.assign({}, edit, { location: '區中心', positions: [cook, { name: '交通', max: '2' }] }) }).ok, true);
  const l = log(/^測試修改｜/);
  assert.equal(l.undoLabel, '還原');
  assert.equal(undo(l).ok, true);
  const back = call('adminDutyForEdit', { id }).data.duty;
  assert.equal(back.location, '宏宗');
  assert.deepEqual(back.positions.map((p) => [p.id, p.name]), [[cook.id, '烹飪'], [clean.id, '清潔']]);
  assert.equal(call('adminDuty', { id }).data.signups.length, 1, '報名還在');

  // 放到首頁
  call('adminSetPinned', { id, pinned: true });
  assert.equal(undo(log(/放到首頁/)).ok, true);
  assert.equal(call('adminDutyList').data.duties.find((d) => d.id === id).pinned, false);

  // 搬日期
  call('adminMoveDuty', { id, to: '2026-12-05' });
  assert.equal(undo(log(/2026-12-01 → 2026-12-05/)).ok, true);
  const d = call('adminDuty', { id }).data;
  assert.equal(d.start, '2026-12-01');
  assert.deepEqual(d.signups.map((s) => s.date), ['2026-12-01']);

  // 刪除（先取消報名）
  call('adminCancel', { signupId: d.signups[0].id });
  assert.equal(call('adminDeleteDuty', { id }).ok, true);
  const del = log(/^測試修改｜2026-12-01$/);
  assert.equal(del.action, '刪除勤務');
  assert.equal(undo(del).ok, true);
  assert.deepEqual(call('adminDutyForEdit', { id }).data.duty.positions.map((p) => p.name), ['烹飪', '清潔']);
});

test('成員、分組：新增可以刪掉，修改、刪除可以還原（改名一起改回來）', () => {
  const { call, log, undo } = setup();
  const members = () => call('adminMembers').data.members;
  call('adminSaveMember', { member: { name: '測試庚', identity: '道親' } });
  assert.equal(log(/新增｜測試庚/).undoLabel, '刪掉');
  assert.equal(undo(log(/新增｜測試庚/)).ok, true);
  assert.equal(members().some((m) => m.name === '測試庚'), false);

  call('adminSaveMember', { member: { name: '測試辛', identity: '道親', note: '原本的備註' } });
  const m = members().find((x) => x.name === '測試辛');
  call('adminSaveMember', { row: m.row, original: '測試辛', member: { name: '測試壬', identity: '壇辦', note: '' } });
  assert.equal(undo(log(/測試辛 → 測試壬/)).ok, true);
  const m2 = members().find((x) => x.name === '測試辛');
  assert.ok(m2, '名字改回來');
  assert.deepEqual([m2.identity, m2.note], ['道親', '原本的備註']);

  call('adminSaveMember', { row: m2.row, original: '測試辛', member: { name: '測試辛', identity: '道親', active: false } });
  call('adminDeleteMember', { row: members().find((x) => x.name === '測試辛').row, original: '測試辛' });
  assert.equal(undo(log(/^刪除｜測試辛/)).ok, true);
  assert.ok(members().some((x) => x.name === '測試辛'));

  // 分組：新增 → 改名（成員組別一起改）→ 還原；刪除（清空的成員組別）→ 還原
  call('adminSaveGroup', { group: { type: '打掃組', name: '第8組', leader: '測試甲' } });
  call('adminSaveMember', { row: members().find((x) => x.name === '測試辛').row, original: '測試辛', member: { name: '測試辛', identity: '道親', groups: { '打掃組': '第8組' } } });
  const groups = () => call('adminGroups').data.groups;
  const g = groups().find((x) => x.name === '第8組');
  call('adminSaveGroup', { row: g.row, original: '第8組', group: { type: '打掃組', name: '第9組', leader: '測試乙' } });
  assert.equal(undo(log(/第8組 → 第9組/)).ok, true);
  const g2 = groups().find((x) => x.name === '第8組');
  assert.equal(g2.leader, '測試甲');
  assert.equal(members().find((x) => x.name === '測試辛').groups['打掃組'], '第8組');
  call('adminDeleteGroup', { row: g2.row, original: '第8組' });
  assert.equal(members().find((x) => x.name === '測試辛').groups['打掃組'], '');
  assert.equal(undo(log(/^刪除｜打掃組 第8組/)).ok, true);
  assert.ok(groups().some((x) => x.name === '第8組'));
  assert.equal(members().find((x) => x.name === '測試辛').groups['打掃組'], '第8組');
  // 新增的組可以刪掉
  assert.equal(undo(log(/^新增｜打掃組 第8組/)).ok, true);
  assert.equal(groups().some((x) => x.name === '第8組'), false);
});

test('出席確認可以還原；舊紀錄沒有存資料的不能按', () => {
  const { env, call, log, undo } = setup(Date.UTC(2026, 11, 20, 2, 0, 0));
  const id = call('adminCreateDuties', { duties: [duty({ name: '測試出席', start: '2026-12-19' })] }).data.ids[0];
  call('adminAttendOk', { items: [{ dutyId: id, date: '2026-12-19' }] });
  assert.ok(call('adminDuty', { id }).data.attendOk['2026-12-19']);
  assert.equal(undo(log(/出席確認好了/)).ok, true);
  assert.equal(call('adminDuty', { id }).data.attendOk['2026-12-19'], undefined);
  // 舊的紀錄（沒有存資料）
  env.fn('writeDutyLog_')('修改勤務', '測試舊紀錄｜2026-01-01');
  const old = log(/測試舊紀錄/);
  assert.equal(old.restorable, false);
  assert.equal(undo(old).error.code, 'BAD_REQUEST');
});
