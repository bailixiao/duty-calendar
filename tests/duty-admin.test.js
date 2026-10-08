// 管理後台：勤務新增、修改、同名勤務一次改、刪除。
// 執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createEnv } = require('./env');

// DutyRules.gs 用到 Rules.gs 的函式，兩個檔案接在一起執行
const mod = { exports: {} };
const dir = path.join(__dirname, '..', 'apps-script');
const src = ['Rules.gs', 'DutyRules.gs'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')
  .replace(/if \(typeof module !== 'undefined'\) \{[\s\S]*?\n\}\n?/, '')).join('\n');
new Function('module', src + `
module.exports = { normalizeDutyInput_, checkDutyChange_, mergeBulkInput_, seriesKey_, renameLike_, cleanTime_ };`)(mod);
const { normalizeDutyInput_, checkDutyChange_, mergeBulkInput_, seriesKey_, renameLike_, cleanTime_ } = mod.exports;

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function base(overrides) {
  return Object.assign({
    name: '測試勤務', nature: '勤務', mode: '報名型', start: '2026-12-01', end: '',
    startTime: '8:00', endTime: '12:00', location: '宏宗',
    positions: [{ name: '志工', min: '', max: '2' }]
  }, overrides);
}

// ---------- 純邏輯 ----------

test('normalizeDutyInput_：補預設值、時間補零、結束日預設同開始日', () => {
  const n = normalizeDutyInput_(base(), { groups: [] });
  assert.deepEqual(n.errors, []);
  assert.equal(n.duty['結束日'], '2026-12-01');
  assert.equal(n.duty['開始時間'], '08:00');
  assert.deepEqual(n.positions, [{ id: '', '了愿項目名稱': '志工', '時段': '', '最少': '', '最多': '2' }]);
  assert.equal(cleanTime_('9：30'), '09:30');
});

test('normalizeDutyInput_：各種錯誤', () => {
  const errs = (o, ctx) => normalizeDutyInput_(base(o), ctx || { groups: ['打掃組|第1組'] }).errors.join('／');
  assert.match(errs({ name: ' ' }), /請填勤務名稱/);
  assert.match(errs({ start: '2026/12/01' }), /開始日格式錯誤/);
  assert.match(errs({ end: '2026-11-30' }), /結束日不能早於開始日/);
  assert.match(errs({ end: '2027-03-01' }), /最多 60 天/);
  assert.match(errs({ startTime: '25:00' }), /開始時間格式錯誤/);
  assert.match(errs({ group: '第1組' }), /要選分組類型/);
  assert.match(errs({ groupType: '打掃組', group: '第9組' }), /沒有「第9組」/);
  assert.match(errs({ positions: [] }), /至少要有一個了愿項目/);
  assert.match(errs({ positions: [{ name: '甲' }, { name: '甲' }] }), /重複/);
  assert.match(errs({ positions: [{ name: '甲', min: '3', max: '2' }] }), /最少人數不能大於最多人數/);
  assert.match(errs({ positions: [{ name: '甲', min: '兩' }] }), /最少人數要是整數/);
  assert.match(errs({ mode: '公告型' }), /要選輪值的負責組/);
  assert.doesNotMatch(errs({ mode: '公告型', category: '道務', nature: '會議' }), /負責組/, '道務的公告型不用負責組');
  // 公告型不留了愿項目
  const notice = normalizeDutyInput_(base({ mode: '公告型', groupType: '打掃組', group: '第1組' }), { groups: ['打掃組|第1組'] });
  assert.deepEqual(notice.errors, []);
  assert.deepEqual(notice.positions, []);
});

const oldPositions = [
  { '了愿項目ID': 'P1', '了愿項目名稱': '烹飪', '最少': '4', '最多': '4' },
  { '了愿項目ID': 'P2', '了愿項目名稱': '清潔', '最少': '', '最多': '' }
];
const signup = (p, date, extra) => Object.assign({ '了愿項目ID': p, '日期': date, '狀態': '有效', '陪同': '否' }, extra);

test('checkDutyChange_：有人報名的了愿項目不能刪、日期不能移出、不能改公告型；最多調低只警告', () => {
  const next = (o) => normalizeDutyInput_(base(Object.assign({ start: '2026-11-08', end: '2026-11-10' }, o)), {});
  const signups = [signup('P1', '2026-11-08'), signup('P1', '2026-11-08'), signup('P2', '2026-11-10'), signup('P2', '2026-11-09', { '狀態': '已取消' })];

  const removed = checkDutyChange_(oldPositions, next({ positions: [{ id: 'P1', name: '烹飪', max: '4' }] }), signups);
  assert.match(removed.errors.join(), /「清潔」已有 1 筆報名，不能刪除/);

  const shrink = checkDutyChange_(oldPositions, next({ end: '2026-11-09', positions: [{ id: 'P1', name: '烹飪' }, { id: 'P2', name: '清潔' }] }), signups);
  assert.match(shrink.errors.join(), /11\/10 已有 1 筆報名，不能移出勤務期間/);

  const lower = checkDutyChange_(oldPositions, next({ positions: [{ id: 'P1', name: '烹飪', max: '1' }, { id: 'P2', name: '清潔' }] }), signups);
  assert.deepEqual(lower.errors, []);
  assert.match(lower.warnings.join(), /11\/8「烹飪」已有 2 人，超過新的最多人數 1 人/);

  const notice = checkDutyChange_(oldPositions, normalizeDutyInput_(base({ mode: '公告型', groupType: '打掃組', group: '第1組' }), {}), signups);
  assert.match(notice.errors.join(), /不能改成公告型/);

  // 只有已取消的報名：什麼都能改
  assert.deepEqual(checkDutyChange_(oldPositions, next({ positions: [{ name: '新的' }] }), [signup('P1', '2026-11-08', { '狀態': '已取消' })]),
    { errors: [], warnings: [] });
});

test('seriesKey_：去掉農曆日期與括號說明', () => {
  assert.equal(seriesKey_('九月初一拜香輪值'), '拜香輪值');
  assert.equal(seriesKey_('十二月十五拜香輪值（大典）'), '拜香輪值');
  assert.equal(seriesKey_('閏六月初一拜香輪值'), '拜香輪值');
  assert.equal(seriesKey_('初一十五打掃（宏宗）'), '初一十五打掃');
  assert.equal(seriesKey_('彌勒山志工輪值'), '彌勒山志工輪值');
});

test('renameLike_：只換改動的那一段', () => {
  assert.equal(renameLike_('十月初一拜香輪值', '九月初一拜香輪值', '九月初一拜香開課'), '十月初一拜香開課');
  assert.equal(renameLike_('十月十五拜香輪值（大典）', '九月初一拜香輪值', '九月初一拜香開課'), '十月十五拜香開課（大典）');
  assert.equal(renameLike_('彌勒山志工輪值', '彌勒山志工輪值', '彌勒山志工'), '彌勒山志工');
  assert.equal(renameLike_('甲乙', '甲乙', '甲乙丙'), '甲乙丙');
});

test('mergeBulkInput_：只套用勾選的欄位；了愿項目依原名稱對應更新、新增、刪除；日期不動', () => {
  const target = { '名稱': '十月初一測試', '性質': '勤務', '模式': '報名型', '開始日': '2026-11-09', '結束日': '2026-11-09',
    '開始時間': '08:00', '結束時間': '10:00', '地點': '宏宗', '分組類型': '', '負責組': '', '服裝': '自行穿著', '說明': '原說明' };
  const targetPositions = [
    { '了愿項目ID': 'T1', '了愿項目名稱': '烹飪', '時段': '', '最少': '4', '最多': '4' },
    { '了愿項目ID': 'T2', '了愿項目名稱': '清潔', '時段': '', '最少': '', '最多': '' },
    { '了愿項目ID': 'T3', '了愿項目名稱': '只有對方有', '時段': '', '最少': '', '最多': '' }
  ];
  // 來源：烹飪改名「廚房」人數 3、刪掉清潔、新增「交通」；服裝改白色 POLO 衫；說明也改了但沒勾
  const next = normalizeDutyInput_(base({
    name: '九月初一測試', start: '2026-10-10', attire: '白色 POLO 衫', description: '新說明',
    positions: [{ id: 'P1', name: '廚房', max: '3' }, { name: '交通', max: '2' }]
  }), {});
  const merged = mergeBulkInput_(target, targetPositions, '九月初一測試', oldPositions, next, ['attire', 'positions']);
  assert.equal(merged.attire, '白色 POLO 衫');
  assert.equal(merged.description, '原說明');
  assert.equal(merged.start, '2026-11-09');
  assert.equal(merged.name, '十月初一測試');
  assert.deepEqual(merged.positions.map((p) => [p.id, p.name, p.max]), [
    ['T1', '廚房', '3'], ['T3', '只有對方有', ''], [undefined, '交通', '2']
  ]);
});

// ---------- API ----------

function login(env) {
  return env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
}

function admin(env, token, action, body) {
  return env.post(Object.assign({ action, token }, body));
}

test('新增勤務：一筆與多筆；有錯整批不寫入；沒有通行碼不能用', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const before = env.sheets['勤務'].data.length;

  assert.equal(env.post({ action: 'adminCreateDuties', duties: [base()] }).error.code, 'UNAUTHORIZED');

  const bad = admin(env, token, 'adminCreateDuties', { duties: [base(), base({ name: '' })] });
  assert.equal(bad.error.code, 'VALIDATION');
  assert.deepEqual(bad.error.details.map((d) => d.index), [1]);
  assert.equal(env.sheets['勤務'].data.length, before);

  const ok = admin(env, token, 'adminCreateDuties', { duties: [base(), base({ start: '2026-12-15', positions: [{ name: '甲' }, { name: '乙', min: '1', max: '3' }] })] });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(ok.data.ids.length, 2);
  assert.equal(env.sheets['勤務'].data.length, before + 2);

  const duty = env.get({ action: 'getDuty', id: ok.data.ids[1] }).data;
  assert.deepEqual(duty.positions.map((p) => [p.name, p.min, p.max]), [['甲', 2, null], ['乙', 1, 3]]);
  assert.equal(duty.startTime, '08:00');

  const log = env.sheets['操作紀錄'].data.slice(-1)[0];
  assert.equal(log[1], '新增勤務');
  assert.match(log[3], /共 2 筆/);
});

test('勤務列表與編輯資料：了愿項目照原樣（空白就是空白），附同名勤務', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const list = admin(env, token, 'adminDutyList').data;
  const first = list.duties.find((d) => d.name === '九月初一拜香輪值');
  assert.ok(first);
  const edit = admin(env, token, 'adminDutyForEdit', { id: first.id }).data;
  assert.equal(edit.duty.name, '九月初一拜香輪值');
  assert.equal(edit.siblings.length, 7, '其他月份的拜香輪值（含大典）都算同名');
  assert.ok(edit.siblings.every((s) => /拜香輪值/.test(s.name)));
  assert.ok(edit.groups.some((g) => g.type === '拜香輪值組'));

  const volunteer = list.duties.find((d) => d.name === '彌勒山志工輪值');
  const v = admin(env, token, 'adminDutyForEdit', { id: volunteer.id }).data;
  assert.deepEqual(v.duty.positions.map((p) => [p.name, p.min, p.max]), [['志工', '', '2']]);
});

test('修改勤務：欄位、了愿項目新增與刪除；有人報名的了愿項目不能刪；最多調低只警告', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-01', end: '2026-12-03', positions: [{ name: '烹飪', max: '4' }, { name: '清潔' }] })] }).data.ids[0];
  const edit = admin(env, token, 'adminDutyForEdit', { id }).data.duty;
  const [cook, clean] = edit.positions;

  // 兩人報烹飪
  const s = env.post({ action: 'signup', dutyId: id, positionId: cook.id, dates: ['2026-12-02'], entries: [{ name: '測試甲' }, { name: '測試乙' }] });
  assert.equal(s.ok, true, JSON.stringify(s.error));

  const blocked = admin(env, token, 'adminUpdateDuty', { id, duty: Object.assign({}, edit, { positions: [clean] }) });
  assert.equal(blocked.error.code, 'VALIDATION');
  assert.match(blocked.error.details[0].message, /「烹飪」已有 2 筆報名，不能刪除/);

  const r = admin(env, token, 'adminUpdateDuty', {
    id, duty: Object.assign({}, edit, { location: '區中心', positions: [Object.assign({}, cook, { max: '1' }), { name: '交通', max: '2' }] })
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(r.data.warnings.join(), /12\/2「烹飪」已有 2 人/);

  const after = env.get({ action: 'getDuty', id }).data;
  assert.equal(after.location, '區中心');
  assert.deepEqual(after.positions.map((p) => [p.id === cook.id, p.name, p.max]), [[true, '烹飪', 1], [false, '交通', 2]]);
  assert.equal(after.signups.length, 2, '報名不受影響');
  assert.equal(env.sheets['操作紀錄'].data.slice(-1)[0][1], '修改勤務');
});

test('同名勤務一次改：服裝套用到其他月份的拜香輪值，日期與名稱不動', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const list = admin(env, token, 'adminDutyList').data.duties;
  const first = list.find((d) => d.name === '九月初一拜香輪值');
  const edit = admin(env, token, 'adminDutyForEdit', { id: first.id }).data;
  const alsoIds = edit.siblings.map((s) => s.id);

  const r = admin(env, token, 'adminUpdateDuty', {
    id: first.id, duty: Object.assign({}, edit.duty, { attire: '自行穿著', description: '只改這一筆' }),
    alsoIds, fields: ['attire']
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.updated, alsoIds.length + 1);

  const other = env.get({ action: 'getDuty', id: alsoIds[3] }).data;
  assert.equal(other.attire, '自行穿著');
  assert.notEqual(other.description, '只改這一筆');
  assert.equal(other.name, edit.siblings[3].name);
  assert.equal(other.start, edit.siblings[3].start);
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /連同其他 \d+ 筆同名勤務：服裝/);

  // 不同名的勤務不能一起改
  const volunteer = list.find((d) => d.name === '彌勒山志工輪值');
  const bad = admin(env, token, 'adminUpdateDuty', { id: first.id, duty: edit.duty, alsoIds: [volunteer.id], fields: ['attire'] });
  assert.equal(bad.error.code, 'BAD_REQUEST');
});

test('同名勤務一次改：其中一筆不能改就全部不寫入', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const ids = admin(env, token, 'adminCreateDuties', {
    duties: ['2026-12-01', '2026-12-08'].map((d) => base({ start: d, positions: [{ name: '烹飪' }, { name: '清潔' }] }))
  }).data.ids;
  const second = admin(env, token, 'adminDutyForEdit', { id: ids[1] }).data.duty;
  env.post({ action: 'signup', dutyId: ids[1], positionId: second.positions[1].id, dates: ['2026-12-08'], entries: [{ name: '測試甲' }] });

  const first = admin(env, token, 'adminDutyForEdit', { id: ids[0] }).data.duty;
  const r = admin(env, token, 'adminUpdateDuty', {
    id: ids[0], duty: Object.assign({}, first, { location: '區中心', positions: [first.positions[0]] }),
    alsoIds: [ids[1]], fields: ['location', 'positions']
  });
  assert.equal(r.error.code, 'VALIDATION');
  assert.match(r.error.details[0].message, /^12\/8：了愿項目「清潔」已有 1 筆報名/);
  assert.equal(env.get({ action: 'getDuty', id: ids[0] }).data.location, '宏宗', '第一筆也沒改');
});

test('刪除勤務：有有效報名不能刪；沒有就連同了愿項目刪掉', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base()] }).data.ids[0];
  const pid = admin(env, token, 'adminDutyForEdit', { id }).data.duty.positions[0].id;
  const s = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-12-01'], entries: [{ name: '測試甲' }] });

  assert.equal(admin(env, token, 'adminDeleteDuty', { id }).error.code, 'FORBIDDEN');
  env.post({ action: 'cancel', signupId: s.data.created[0].id });

  const positionsBefore = env.sheets['了愿項目'].data.length;
  const r = admin(env, token, 'adminDeleteDuty', { id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(env.get({ action: 'getDuty', id }).error.code, 'NOT_FOUND');
  assert.equal(env.sheets['了愿項目'].data.length, positionsBefore - 1);
  const log = env.sheets['操作紀錄'].data.slice(-1)[0];
  assert.equal(log[1], '刪除勤務');
  assert.match(log[4], /"勤務ID"/);
  // 刪除後其他勤務照常
  assert.equal(admin(env, token, 'adminDutyList').ok, true);
});

test('報名截止日：過了截止日不能報名（管理者補登不受限）；活動不算勤務統計；一起改時不動截止日', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ name: '測試活動', nature: '活動', start: '2026-10-11', deadline: '2026-08-31', positions: [{ name: '長者' }] })] }).data.ids[0];
  const d = env.get({ action: 'getDuty', id }).data;
  assert.equal(d.deadline, '2026-08-31');
  assert.equal(d.nature, '活動');
  const s = env.post({ action: 'signup', dutyId: id, positionId: d.positions[0].id, dates: ['2026-10-11'], entries: [{ name: '測試甲' }] });
  assert.equal(s.error.code, 'VALIDATION');
  assert.match(s.error.details[0].message, /報名已截止/);
  const add = admin(env, token, 'adminAddAttendee', { dutyId: id, positionId: d.positions[0].id, date: '2026-10-11', name: '測試甲', identity: '道親' });
  assert.equal(add.ok, true, JSON.stringify(add.error));
  env.clock.now = Date.UTC(2026, 9, 12, 2);
  assert.ok(!admin(env, token, 'adminStats').data.events.some((e) => e.dutyId === id), '活動不算勤務統計');
  assert.match(admin(env, token, 'adminCreateDuties', { duties: [base({ deadline: '2026/8/31' })] }).error.details[0].message, /報名截止日格式錯誤/);
});

test('活動：參加者不能個別改期（管理者也一樣）；活動本身改日期時名單一起移過去；一般勤務照舊不能移', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ name: '測試活動', nature: '活動', start: '2026-10-11', positions: [{ name: '長者' }] })] }).data.ids[0];
  const pid = env.get({ action: 'getDuty', id }).data.positions[0].id;
  const s = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-11'], entries: [{ name: '測試甲' }, { name: '測試乙' }] });
  const sid = s.data.created[0].id;
  assert.equal(env.post({ action: 'reschedule', signupId: sid, dutyId: id, date: '2026-10-11', positionId: pid }).error.code, 'FORBIDDEN');
  assert.equal(admin(env, token, 'adminReschedule', { signupId: sid, dutyId: id, date: '2026-10-11', positionId: pid }).error.code, 'FORBIDDEN');

  const edit = admin(env, token, 'adminDutyForEdit', { id }).data.duty;
  const r = admin(env, token, 'adminUpdateDuty', { id, duty: Object.assign({}, edit, { start: '2026-10-18', end: '2026-10-18' }) });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.moved, 2);
  const after = env.get({ action: 'getDuty', id }).data;
  assert.equal(after.start, '2026-10-18');
  assert.deepEqual(after.signups.map((x) => x.date), ['2026-10-18', '2026-10-18']);
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /2026-10-11 → 2026-10-18（名單 2 筆一起移過去）/);

  // 一般勤務：有人報名的日期仍不能移走
  const id2 = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-05' })] }).data.ids[0];
  const p2 = env.get({ action: 'getDuty', id: id2 }).data.positions[0].id;
  env.post({ action: 'signup', dutyId: id2, positionId: p2, dates: ['2026-12-05'], entries: [{ name: '測試丙' }] });
  const e2 = admin(env, token, 'adminDutyForEdit', { id: id2 }).data.duty;
  assert.equal(admin(env, token, 'adminUpdateDuty', { id: id2, duty: Object.assign({}, e2, { start: '2026-12-06', end: '2026-12-06' }) }).error.code, 'VALIDATION');
});

test('可兼任：同一人可報同一天的不同了愿項目（同一項目仍不能重複）；統計同一場只算一次', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-10-24', multi: true, positions: [{ name: '淨手', max: '1' }, { name: '茶水', max: '2' }] })] }).data.ids[0];
  const d = env.get({ action: 'getDuty', id }).data;
  assert.equal(d.multi, true);
  const [p1, p2] = d.positions;
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: p1.id, dates: ['2026-10-24'], entries: [{ name: '測試甲' }] }).ok, true);
  const second = env.post({ action: 'signup', dutyId: id, positionId: p2.id, dates: ['2026-10-24'], entries: [{ name: '測試甲' }] });
  assert.equal(second.ok, true, JSON.stringify(second.error));
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: p2.id, dates: ['2026-10-24'], entries: [{ name: '測試甲' }] }).error.code, 'VALIDATION', '同一項目不能重複');
  env.clock.now = Date.UTC(2026, 9, 25, 2);
  const ev = admin(env, token, 'adminStats').data.events.find((e) => e.dutyId === id);
  assert.deepEqual(ev.dao, ['測試甲'], '兼任只算一次');

  // 沒勾可兼任：維持一天只能報一個項目
  const id2 = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-05', positions: [{ name: '甲項' }, { name: '乙項' }] })] }).data.ids[0];
  const d2 = env.get({ action: 'getDuty', id: id2 }).data;
  assert.equal(d2.multi, false);
  env.clock.now = OCT_1;
  env.post({ action: 'signup', dutyId: id2, positionId: d2.positions[0].id, dates: ['2026-12-05'], entries: [{ name: '測試乙' }] });
  assert.equal(env.post({ action: 'signup', dutyId: id2, positionId: d2.positions[1].id, dates: ['2026-12-05'], entries: [{ name: '測試乙' }] }).error.code, 'VALIDATION');
  // 編輯資料帶出可兼任
  assert.equal(admin(env, token, 'adminDutyForEdit', { id }).data.duty.multi, '是');
});

test('草稿新增：可以一起帶入已分配的人員（身分照成員名單）；項目名稱對不上要擋', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  admin(env, token, 'adminSaveMember', { member: { name: '測試甲', identity: '壇辦' } });
  const bad = admin(env, token, 'adminCreateDuties', { duties: [base({ positions: [{ name: '交通' }], assign: { '茶水': ['測試甲'] } })] });
  assert.match(bad.error.details[0].message, /「茶水」不是這個勤務的了愿項目/);
  const r = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-10', positions: [{ name: '交通', max: '2' }, { name: '茶水' }], assign: { '交通': ['測試甲', '測試乙'] } })] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const d = admin(env, token, 'adminDuty', { id: r.data.ids[0] }).data;
  assert.deepEqual(d.signups.map((s) => [s.name, s.identity, s.date]), [['測試甲', '壇辦', '2026-12-10'], ['測試乙', '', '2026-12-10']]);
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /含分配人員 2 人/);
});

test('新增勤務：已有同名同日的會先回報 DUPLICATE，確認後才新增', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  assert.equal(admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-12' })] }).ok, true);
  const again = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-12' })] });
  assert.equal(again.error.code, 'DUPLICATE');
  assert.match(again.error.details[0].message, /測試勤務（2026-12-12）/);
  assert.equal(admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-12' })], allowDuplicate: true }).ok, true);
});

test('可兼任：一次報多個了愿項目（positionIds）；整批檢查、任一項額滿就都不寫入；不可兼任的勤務不能一次報多項', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-10-24', multi: true, positions: [{ name: '淨手', max: '1' }, { name: '茶水', max: '2' }] })] }).data.ids[0];
  const [p1, p2] = env.get({ action: 'getDuty', id }).data.positions;
  const r = env.post({ action: 'signup', dutyId: id, positionIds: [p1.id, p2.id], dates: ['2026-10-24'], entries: [{ name: '測試甲' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.created.map((c) => c.positionId), [p1.id, p2.id]);
  // 淨手已滿：兩項一起報 → 整批不寫入
  const before = env.sheets['報名'].data.length;
  const full = env.post({ action: 'signup', dutyId: id, positionIds: [p1.id, p2.id], dates: ['2026-10-24'], entries: [{ name: '測試乙' }] });
  assert.equal(full.error.code, 'VALIDATION');
  assert.match(full.error.details[0].message, /「淨手」.*額滿/);
  assert.equal(env.sheets['報名'].data.length, before);

  const id2 = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-05', positions: [{ name: '甲項' }, { name: '乙項' }] })] }).data.ids[0];
  const d2 = env.get({ action: 'getDuty', id: id2 }).data.positions;
  assert.equal(env.post({ action: 'signup', dutyId: id2, positionIds: [d2[0].id, d2[1].id], dates: ['2026-12-05'], entries: [{ name: '測試丙' }] }).error.code, 'BAD_REQUEST');
});

test('一次幫多人報不同的了愿項目（每個名字各自 positionIds）；一般勤務每人一項、同一人不能分兩項', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-05', positions: [{ name: '甲項' }, { name: '乙項' }] })] }).data.ids[0];
  const [a, b] = env.get({ action: 'getDuty', id }).data.positions;
  const r = env.post({ action: 'signup', dutyId: id, positionId: a.id, dates: ['2026-12-05'],
    entries: [{ name: '測試甲' }, { name: '測試乙', positionIds: [b.id] }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.created.map((c) => [c.name, c.positionId]), [['測試甲', a.id], ['測試乙', b.id]]);
  // 一般勤務：同一人分到兩項 → 擋
  const dup = env.post({ action: 'signup', dutyId: id, positionId: a.id, dates: ['2026-12-05'],
    entries: [{ name: '測試丙', positionIds: [a.id] }, { name: '測試丙', positionIds: [b.id] }] });
  assert.equal(dup.error.code, 'VALIDATION');
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: a.id, dates: ['2026-12-05'], entries: [{ name: '測試丁', positionIds: [a.id, b.id] }] }).error.code, 'BAD_REQUEST');
});

test('刪除勤務：同名的可以一起刪；任一筆還有報名就整批不刪', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: ['2027-01-06', '2027-01-13', '2027-01-20'].map((d) => ({ name: '週三讀經班', start: d, positions: [{ name: '參加' }] })) });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const [a, b, d] = c.data.ids;
  const ed = call('adminDutyForEdit', { id: a }).data;
  assert.deepEqual(ed.siblings.map((x) => [x.id, x.signups]), [[b, 0], [d, 0]]);
  const pid = env.get({ action: 'getDuty', id: d }).data.positions[0].id;
  assert.equal(env.post({ action: 'signup', dutyId: d, positionId: pid, dates: ['2027-01-20'], entries: [{ name: '測試甲', identity: '道親' }] }).ok, true);
  const r = call('adminDeleteDuty', { id: a, alsoIds: [b, d] });
  assert.equal(r.error.code, 'FORBIDDEN');
  assert.match(r.error.details[0].message, /2027-01-20/);
  assert.equal(call('adminDutyList', {}).data.duties.filter((x) => x.name === '週三讀經班').length, 3, '整批沒刪');
  const ok = call('adminDeleteDuty', { id: a, alsoIds: [b] });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(ok.data.deleted, 2);
  assert.deepEqual(call('adminDutyList', {}).data.duties.filter((x) => x.name === '週三讀經班').map((x) => x.id), [d]);
});

test('同名一起改：師資可以套用到過去與未來的堂次；類別、DM、職司表設定不會被洗掉', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: ['2026-09-05', '2026-09-12', '2026-10-10'].map((d) => ({ name: '高大班', category: '教育', nature: '課程', start: d, positions: [{ name: '參加', min: '0' }], teachers: '測試甲' })) });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const [a, b, d] = c.data.ids;
  const ed = call('adminDutyForEdit', { id: a }).data.duty;
  ed.teachers = '測試乙';
  const r = call('adminUpdateDuty', { id: a, duty: ed, alsoIds: [b], fields: ['teachers'] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const get = (id) => env.get({ action: 'getDuty', id }).data;
  assert.deepEqual([get(a).teachers, get(b).teachers, get(d).teachers], ['測試乙', '測試乙', '測試甲']);
  assert.equal(get(b).category, '教育');
  assert.equal(get(b).nature, '課程');
});

test('同名一起改：DM 也可以一起套用', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: ['2026-10-10', '2026-10-17'].map((d) => ({ name: '高大班', category: '教育', nature: '課程', start: d, positions: [{ name: '參加', min: '0' }] })) });
  const [a, b] = c.data.ids;
  const ed = call('adminDutyForEdit', { id: a }).data.duty;
  ed.dm = [{ id: 'F-abcdef123456', name: 'dm.jpg', mime: 'image/jpeg' }];
  assert.equal(call('adminUpdateDuty', { id: a, duty: ed, alsoIds: [b], fields: ['dm'] }).ok, true);
  assert.equal(env.get({ action: 'getDuty', id: b }).data.dm[0].id, 'F-abcdef123456');
});

test('安排整年的師資：一次改好幾堂的師資，只動師資；只能改教育', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: ['2026-09-05', '2026-10-10', '2026-11-07'].map((d) => ({ name: '高大班', category: '教育', nature: '課程', start: d, location: '區中心', positions: [{ name: '參加', min: '0' }] })) });
  const [a, b, d] = c.data.ids;
  assert.equal(call('adminDutyForEdit', { id: a }).data.siblings[0].teachers, '');
  const r = call('adminSetTeachers', { items: [{ id: a, teachers: '測試甲，測試乙' }, { id: b, teachers: '測試甲' }, { id: d, teachers: '' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.updated, 2); // d 本來就空白
  const get = (id) => env.get({ action: 'getDuty', id }).data;
  assert.deepEqual([get(a).teachers, get(b).teachers, get(a).location], ['測試甲、測試乙', '測試甲', '區中心']);
  const other = call('adminCreateDuties', { duties: [{ name: '打掃', start: '2026-10-11', positions: [{ name: '打掃' }] }] }).data.ids[0];
  assert.equal(call('adminSetTeachers', { items: [{ id: other, teachers: '測試甲' }] }).error.code, 'BAD_REQUEST');
});

test('合併顯示：初一十五班填「拜香輪值」，報名頁帶出同一天的拜香輪值；那天沒有就是 null', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: [
    { name: '初一十五班', category: '道務', nature: '課程', start: '2026-10-10', merge: '拜香輪值', positions: [{ name: '參加', min: '0' }] },
    { name: '初一十五班', category: '道務', nature: '課程', start: '2026-10-25', merge: '拜香輪值', positions: [{ name: '參加', min: '0' }] }
  ] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const [a, b] = c.data.ids; // 測試資料本來就有 10/10 的九月初一拜香輪值
  const da = env.get({ action: 'getDuty', id: a }).data;
  assert.equal(da.merge, '拜香輪值');
  assert.match(da.mergeHost.name, /拜香輪值/);
  assert.equal(env.get({ action: 'getDuty', id: b }).data.mergeHost, null);
});

test('重複檢查：同類別、同名、同日才算重複；道務的闡道班和勤務的闡道班不算', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(call('adminCreateDuties', { duties: [{ name: '闡道班', start: '2026-11-08', positions: [{ name: '烹飪' }] }] }).ok, true);
  assert.equal(call('adminCreateDuties', { duties: [{ name: '闡道班', category: '道務', nature: '課程', start: '2026-11-08', positions: [{ name: '參加', min: '0' }] }] }).ok, true);
  assert.equal(call('adminCreateDuties', { duties: [{ name: '闡道班', start: '2026-11-08', positions: [{ name: '烹飪' }] }] }).error.code, 'DUPLICATE');
});

test('道務：講師、帶班、助理帶班（只有道務存）；安排整年的人員一次改；統計堂次帶人員', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 30, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: [
    { name: '初一十五班', category: '道務', nature: '課程', start: '2026-10-10', lecturers: '測試甲', leaders: '測試乙', assistants: '測試丙', positions: [{ name: '參加', min: '0' }] },
    { name: '初一十五班', category: '道務', nature: '課程', start: '2026-10-25', positions: [{ name: '參加', min: '0' }] },
    { name: '打掃', start: '2026-10-11', lecturers: '不該存', positions: [{ name: '打掃' }] }
  ] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const [a, b, x] = c.data.ids;
  const da = env.get({ action: 'getDuty', id: a }).data;
  assert.deepEqual([da.lecturers, da.leaders, da.assistants], ['測試甲', '測試乙', '測試丙']);
  assert.equal(env.get({ action: 'getDuty', id: x }).data.lecturers, '');
  const r = call('adminSetTeachers', { items: [{ id: b, leaders: '測試丙', assistants: '測試丁，測試戊' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const db = env.get({ action: 'getDuty', id: b }).data;
  assert.deepEqual([db.leaders, db.assistants, db.lecturers], ['測試丙', '測試丁、測試戊', '']);
  const sess = call('adminStats', {}).data.eduSessions.filter((s) => s.name === '初一十五班');
  assert.deepEqual(sess.map((s) => [s.date, s.category, s.leaders]), [['2026-10-10', '道務', '測試乙'], ['2026-10-25', '道務', '測試丙']]);
});

test('可兼任＋共需人數：缺幾人＝共需人數－不重複人數；通知列出各項目報名的人', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-10-24', multi: true, totalNeed: '4', positions: [{ name: '淨手', min: '2', max: '2' }, { name: '茶水', min: '3', max: '8' }] })] }).data.ids[0];
  let d = env.get({ action: 'getDuty', id }).data;
  assert.equal(d.totalNeed, 4);
  const [p1, p2] = d.positions;
  env.post({ action: 'signup', dutyId: id, positionId: p1.id, dates: ['2026-10-24'], entries: [{ name: '測試甲' }] });
  env.post({ action: 'signup', dutyId: id, positionId: p2.id, dates: ['2026-10-24'], entries: [{ name: '測試甲' }, { name: '測試乙' }] });
  d = env.get({ action: 'getDuty', id }).data;
  assert.deepEqual([d.days['2026-10-24'].people, d.days['2026-10-24'].shortage], [2, 2], '兩位報了三項，共需 4 位還缺 2 位（不是 5－3）');
  assert.equal(admin(env, token, 'adminDutyForEdit', { id }).data.duty.totalNeed, '4');
  // 沒勾可兼任時共需人數不存
  const id2 = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-12-05', totalNeed: '4' })] }).data.ids[0];
  assert.equal(env.get({ action: 'getDuty', id: id2 }).data.totalNeed, 0);

  // 前端：缺人狀態、需要人數、報名情形
  global.window = global.window || {};
  global.window.SITE = { inviteTitle: '', shortageTitle: '' };
  require('../js/format.js');
  global.Fmt = global.window.Fmt;
  require('../js/share.js');
  const S = global.window.Share;
  assert.equal(global.Fmt.dayState(d, d.days['2026-10-24']).label, '缺 2 人');
  assert.match(S.needText(d, d.days['2026-10-24']), /還缺 2 位（共需 4 位，已報 2 位）/);
  assert.deepEqual(S.rosterLines(d, '2026-10-24', d.signups), ['・淨手（1／2）：測試甲', '・茶水（2／8）：測試甲、測試乙']);
});

test('組長職稱：報名時可選一位當組長，一天一位；後台設新的組長會取消原本的', () => {
  const env = createEnv(OCT_1);
  const token = login(env);
  const id = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-10-24', leaderTitle: '勤務組長', positions: [{ name: '淨手', max: '5' }] })] }).data.ids[0];
  let d = env.get({ action: 'getDuty', id }).data;
  assert.equal(d.leaderTitle, '勤務組長');
  const pid = d.positions[0].id;
  const two = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-24'], entries: [{ name: '測試甲', leader: true }, { name: '測試乙', leader: true }] });
  assert.match(two.error.details.map((x) => x.message).join(), /只要一位/);
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-24'], entries: [{ name: '測試甲', leader: true }, { name: '測試乙' }] }).ok, true);
  const again = env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-24'], entries: [{ name: '測試丙', leader: true }] });
  assert.match(again.error.details.map((x) => x.message).join(), /已經有勤務組長（測試甲）/);
  d = env.get({ action: 'getDuty', id }).data;
  assert.deepEqual(d.signups.filter((s) => s.leader).map((s) => s.name), ['測試甲']);
  // 後台把組長改成測試乙：測試甲自動取消
  const b = d.signups.find((s) => s.name === '測試乙');
  assert.equal(admin(env, token, 'adminSetAttendance', { signupId: b.id, leader: true }).ok, true);
  d = env.get({ action: 'getDuty', id }).data;
  assert.deepEqual(d.signups.filter((s) => s.leader).map((s) => s.name), ['測試乙']);
  // 沒有組長職稱的勤務不能選組長
  const id2 = admin(env, token, 'adminCreateDuties', { duties: [base({ start: '2026-10-25' })] }).data.ids[0];
  const d2 = env.get({ action: 'getDuty', id: id2 }).data;
  assert.equal(env.post({ action: 'signup', dutyId: id2, positionId: d2.positions[0].id, dates: ['2026-10-25'], entries: [{ name: '測試甲', leader: true }] }).error.code, 'VALIDATION');
});
