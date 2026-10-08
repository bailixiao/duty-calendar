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
    row: 2, name: '測試甲', identity: '道親', note: '', active: true, pending: false, vegetarian: false, birthYear: '', age: '', temple: '', aliases: [], overseas: '', careNote: '',
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

test('合併同一人寫法：報名紀錄的名字改成統一寫法，統計不再算成兩個人', () => {
  const { env, call } = setup();
  call('adminImportHistory', { events: [
    { date: '2026-03-05', name: '打掃', tan: ['王小明'], dao: [], accompany: [] },
    { date: '2026-03-12', name: '打掃', tan: ['小明'], dao: [], accompany: [] },
    { date: '2026-03-19', name: '打掃', tan: [' 小明 '], dao: ['測試甲'], accompany: [] },
    { date: '2026-03-26', name: '打掃', tan: ['小明', '王小明'], dao: [], accompany: [] }
  ] });
  assert.equal(call('adminMergeNames', { merges: [] }).error.code, 'BAD_REQUEST');
  const r = call('adminMergeNames', { merges: [{ from: ['小明'], to: '王小明' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data, { changed: 3, dropped: 1 });
  const names = call('adminStats').data.events.flatMap((e) => e.tan);
  assert.deepEqual(names, ['王小明', '王小明', '王小明', '王小明'], '同一場重複的只算一次');
  assert.ok(env.sheets['報名'].data.some((row) => row.includes('測試甲')), '其他人不受影響');
  assert.match(env.sheets['操作紀錄'].data.slice(-1)[0][3], /小明 → 王小明（3 筆報名，其中 1 筆同一場重複、改為已取消）/);
});

test('清掉剩下的名字：只是不再列出（統計照算）或連出勤紀錄一起取消', () => {
  const { call } = setup();
  call('adminImportHistory', { events: [{ date: '2026-03-05', name: '打掃', tan: ['測試甲', '怪字一'], dao: ['怪字二'], accompany: [] }] });
  assert.equal(call('adminClearCandidates', { names: [] }).error.code, 'BAD_REQUEST');

  assert.deepEqual(call('adminClearCandidates', { names: ['怪字一'], cancelSignups: false }).data, { ignored: 1, cancelled: 0 });
  let names = call('adminMemberCandidates').data.candidates.map((c) => c.name);
  assert.deepEqual(names.sort(), ['怪字二', '測試甲'].sort());
  let ev = call('adminStats').data.events[0];
  assert.ok(ev.tan.includes('怪字一'), '只是不列出，統計照算');

  assert.deepEqual(call('adminClearCandidates', { names: ['怪字二'], cancelSignups: true }).data, { ignored: 1, cancelled: 1 });
  assert.deepEqual(call('adminMemberCandidates').data.candidates.map((c) => c.name), ['測試甲']);
  ev = call('adminStats').data.events[0];
  assert.deepEqual(ev.dao, [], '取消後統計不再算');
});

test('刪除成員：只能刪已停用的；報名紀錄不受影響', () => {
  const { call } = setup();
  call('adminSaveMember', { member: { name: '測試甲', identity: '道親' } });
  call('adminImportHistory', { events: [{ date: '2026-03-05', name: '打掃', tan: [], dao: ['測試甲'], accompany: [] }] });
  assert.equal(call('adminDeleteMember', { row: 2, original: '測試甲' }).error.code, 'FORBIDDEN');
  call('adminSaveMember', { row: 2, original: '測試甲', member: { name: '測試甲', identity: '道親', active: false } });
  assert.equal(call('adminDeleteMember', { row: 2, original: '別人' }).error.code, 'CONFLICT');
  assert.equal(call('adminDeleteMember', { row: 2, original: '測試甲' }).ok, true);
  assert.deepEqual(call('adminMembers').data.members, []);
  assert.deepEqual(call('adminStats').data.events[0].dao, ['測試甲']);
});

test('新名字自動加入成員（待確認）：不出現在名字提示；可以合併到名單上的正確寫法；待確認的可以直接刪', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  call('adminSaveMember', { member: { name: '王小明', identity: '壇辦' } });
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '小明', identity: '道親' }, { name: '測試新人', identity: '道親' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  let list = call('adminMembers').data.members;
  const p1 = list.find((m) => m.name === '小明');
  const p2 = list.find((m) => m.name === '測試新人');
  assert.deepEqual([p1.pending, p2.pending, list.find((m) => m.name === '王小明').pending], [true, true, false]);
  assert.match(p1.note, /自動加入：2026-10-13/);
  assert.deepEqual(env.get({ action: 'searchMembers', q: '測試新' }).data.members, [], '待確認的不提示');
  const merged = call('adminMergePendingMember', { row: p1.row, original: '小明', to: '王小明' });
  assert.equal(merged.ok, true, JSON.stringify(merged.error));
  list = call('adminMembers').data.members;
  assert.ok(!list.find((m) => m.name === '小明'), '合併後刪掉那一列');
  const mine = env.post({ action: 'mySignups', name: '王小明' }).data.items;
  assert.equal(mine.length, 1, '報名紀錄改成正確寫法');
  const p2b = list.find((m) => m.name === '測試新人');
  assert.equal(call('adminDeleteMember', { row: p2b.row, original: '測試新人' }).ok, true, '待確認的可以直接刪');
  // 再報一次：名單上已經沒有 → 又會自動加回待確認（出勤紀錄還在）
  assert.equal(call('adminImportAttendance', { sessions: [{ dutyId: ev.id, date: '2026-10-13', entries: [{ name: '測試第三人', identity: '未求道' }] }] }).ok, true);
  assert.equal(call('adminMembers').data.members.find((m) => m.name === '測試第三人').pending, true, '匯入的也會加入');
});

test('清口、年齡：道務帳號可以改清口和年齡（存出生年），勤務帳號不行；年齡不合理擋下', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body, tok) => env.post(Object.assign({ action, token: tok || token }, body));
  call('adminSaveMember', { member: { name: '測試甲', identity: '道親', age: '45', vegetarian: true } });
  let m = call('adminMembers').data.members.find((x) => x.name === '測試甲');
  assert.deepEqual([m.vegetarian, m.birthYear, m.age], [true, 1981, 45]);
  assert.equal(call('adminSaveMember', { member: { name: '測試乙', identity: '道親', age: '200' } }).error.code, 'VALIDATION');
  call('adminSaveAccount', { account: { account: '道務組', role: '道務', password: 'abc12345' } });
  call('adminSaveAccount', { account: { account: '勤務組', role: '勤務', password: 'abc12345' } });
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  const qw = env.post({ action: 'adminLogin', account: '勤務組', password: 'abc12345' }).data.token;
  assert.equal(call('adminSetMemberExtra', { items: [{ row: m.row, original: '測試甲', vegetarian: false }] }, qw).error.code, 'FORBIDDEN');
  const r = call('adminSetMemberExtra', { items: [{ row: m.row, original: '測試甲', vegetarian: false, age: '60' }] }, dw);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  m = r.data.members.find((x) => x.name === '測試甲');
  assert.deepEqual([m.vegetarian, m.age], [false, 60]);
  assert.equal(call('adminSetMemberExtra', { items: [{ row: m.row, original: '測試甲', age: 'abc' }] }, dw).error.code, 'VALIDATION');
});

test('佛堂：同名不同佛堂可以都在名單；報名沒選佛堂會請選；選了佛堂可以同一天都報；統計分開算', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(call('adminSaveMember', { member: { name: '測試甲', identity: '道親', temple: '測試佛堂A' } }).ok, true);
  assert.equal(call('adminSaveMember', { member: { name: '測試甲', identity: '壇辦', temple: '測試佛堂B' } }).ok, true, '同名不同佛堂可以');
  assert.equal(call('adminSaveMember', { member: { name: '測試甲', identity: '道親', temple: '測試佛堂A' } }).error.code, 'VALIDATION', '同名同佛堂擋');
  assert.equal(call('adminSaveMember', { member: { name: '測試甲', identity: '道親' } }).error.code, 'VALIDATION', '沒填佛堂分不出來也擋');
  const sug = env.get({ action: 'searchMembers', q: '測試甲' }).data.members;
  assert.deepEqual(sug.map((m) => [m.temple, m.dup]).sort(), [['測試佛堂A', true], ['測試佛堂B', true]]);
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const base = { action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'] };
  const amb = env.post(Object.assign({}, base, { entries: [{ name: '測試甲', identity: '道親' }] }));
  assert.equal(amb.error.code, 'VALIDATION');
  assert.match(amb.error.details[0].message, /2 位「測試甲」/);
  const ok = env.post(Object.assign({}, base, { entries: [{ name: '測試甲', identity: '道親', temple: '測試佛堂A' }, { name: '測試甲', identity: '道親', temple: '測試佛堂B' }] }));
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const duty = env.get({ action: 'getDuty', id: ev.id }).data;
  assert.deepEqual(duty.signups.map((s) => [s.name, s.temple]).sort(), [['測試甲', '測試佛堂A'], ['測試甲', '測試佛堂B']]);
  env.clock.now = Date.UTC(2026, 9, 20, 2, 0, 0);
  const e = call('adminStats').data.events.find((x) => x.dutyId === ev.id);
  assert.deepEqual([...e.tan, ...e.dao].sort(), ['測試甲（測試佛堂A）', '測試甲（測試佛堂B）'], '統計分開算，身分照名單（B 是壇辦）');
  assert.deepEqual(e.tan, ['測試甲（測試佛堂B）']);
});

test('別名、合併成同一人：打別名報名記成真名；名字提示用別名找得到；合併後報名紀錄改名、只留真名那位', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  call('adminSaveMember', { member: { name: '測試甲', identity: '壇辦', aliases: '小甲' } });
  call('adminSaveMember', { member: { name: '測試乙', identity: '道親' } });
  call('adminSaveMember', { member: { name: '測試乙乙', identity: '壇辦', age: '50' } });
  assert.equal(call('adminSaveMember', { member: { name: '測試丙', aliases: '小甲' } }).error.code, 'VALIDATION', '別名不能重複');
  const sug = env.get({ action: 'searchMembers', q: '小甲' }).data.members;
  assert.deepEqual(sug.map((m) => [m.name, m.alias]), [['測試甲', '小甲']]);
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '小甲', identity: '道親' }, { name: '測試乙乙', identity: '壇辦' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  let names = env.get({ action: 'getDuty', id: ev.id }).data.signups.map((s) => s.name).sort();
  assert.deepEqual(names, ['測試乙乙', '測試甲'], '別名記成真名');
  assert.equal(env.post({ action: 'mySignups', name: '小甲' }).data.items.length, 1, '打別名也查得到');
  // 測試乙乙其實是測試乙（真名＝測試乙）
  const list = call('adminMembers').data.members;
  const keep = list.find((m) => m.name === '測試乙');
  const drop = list.find((m) => m.name === '測試乙乙');
  const mg = call('adminMergeMembers', { keep: { row: keep.row, original: keep.name }, drop: { row: drop.row, original: drop.name } });
  assert.equal(mg.ok, true, JSON.stringify(mg.error));
  const after = mg.data.members.find((m) => m.name === '測試乙');
  assert.deepEqual([after.aliases, after.identity, after.age, !!mg.data.members.find((m) => m.name === '測試乙乙')], [['測試乙乙'], '道親', 50, false]);
  names = env.get({ action: 'getDuty', id: ev.id }).data.signups.map((s) => s.name).sort();
  assert.deepEqual(names, ['測試乙', '測試甲'], '報名紀錄改成真名');
});

test('匯入成員資料：依名字或別名補佛堂、出生年；找不到的回報或新增；同名分不出來的不改', () => {
  const env = createEnv(Date.UTC(2026, 9, 8, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  call('adminSaveMember', { member: { name: '測試甲', identity: '壇辦', aliases: '小甲' } });
  call('adminSaveMember', { member: { name: '測試乙', identity: '道親', age: '30' } });
  call('adminSaveMember', { member: { name: '測試丙', temple: '測試佛堂A' } });
  call('adminSaveMember', { member: { name: '測試丙', temple: '測試佛堂B' } });
  const r = call('adminImportMembers', { items: [{ name: '小甲', temple: '測試佛堂A', birthYear: 1970 }, { name: '測試乙', temple: '測試佛堂B' }, { name: '測試丙', birthYear: 1990 }, { name: '不在名單' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual([r.data.updated, r.data.missing, r.data.ambiguous], [['小甲', '測試乙'], ['不在名單'], ['測試丙']]);
  const list = call('adminMembers').data.members;
  const a = list.find((m) => m.name === '測試甲');
  assert.deepEqual([a.temple, a.birthYear, a.age], ['測試佛堂A', 1970, 56]);
  const b = list.find((m) => m.name === '測試乙');
  assert.deepEqual([b.temple, b.age], ['測試佛堂B', 30], '沒給的年齡不會被清掉');
  const add = call('adminImportMembers', { items: [{ name: '測試新人', temple: '測試佛堂A', birthYear: 2000, identity: '道親' }], addMissing: true });
  assert.deepEqual(add.data.added, ['測試新人']);
  call('adminImportMembers', { items: [{ name: '測試乙', vegetarian: true, overseas: '陸' }, { name: '測試丙', overseas: '火星' }] });
  const after = call('adminMembers').data.members;
  const b2 = after.find((m) => m.name === '測試乙');
  assert.deepEqual([b2.vegetarian, b2.overseas, b2.temple], [true, '陸', '測試佛堂B'], '可以匯入清口、國外，佛堂不變');
});

test('一次補身分、成全紀錄；同名的舊報名紀錄可以指給正確的佛堂', () => {
  const { env, call } = setup();
  call('adminSaveMember', { member: { name: '測試甲' } });
  call('adminSaveMember', { member: { name: '測試丙', temple: '測試佛堂A' } });
  call('adminSaveMember', { member: { name: '測試丙', temple: '測試佛堂B' } });
  let a = call('adminMembers').data.members.find((m) => m.name === '測試甲');
  const r = call('adminSetMemberExtra', { items: [{ row: a.row, original: '測試甲', identity: '道親', careNote: '已和他談過' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  a = r.data.members.find((m) => m.name === '測試甲');
  assert.deepEqual([a.identity, a.careNote], ['道親', '已和他談過']);
  assert.equal(call('adminSetMemberExtra', { items: [{ row: a.row, original: '測試甲', identity: '外星人' }] }).error.code, 'VALIDATION');
  // 沒記佛堂的舊報名（同名不同佛堂）
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.mode !== '公告型');
  const s = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試丙', identity: '道親', temple: '測試佛堂A' }] });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  const sid = s.data.created[0].id;
  const SG = env.fn('SHEETS').SIGNUPS;
  env.fn('updateRow_')(SG, env.fn('readTable_')(SG).find((x) => x['報名ID'] === sid), { '佛堂': '' }); // 模擬舊資料（沒記佛堂）
  env.fn('invalidateTable_')(SG);
  const list = call('adminSameNameSignups').data.items;
  assert.deepEqual(list.map((g) => [g.name, g.signups.length]), [['測試丙', 1]]);
  assert.equal(call('adminAssignSignupTemple', { items: [{ id: sid, temple: '別的佛堂' }] }).data.updated, 0, '只能選成員名單上有的佛堂');
  assert.equal(call('adminAssignSignupTemple', { items: [{ id: sid, temple: '測試佛堂B' }] }).data.updated, 1);
  assert.deepEqual(call('adminSameNameSignups').data.items, []);
});
