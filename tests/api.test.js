// 整合測試：以記憶體模擬 SpreadsheetApp 等 Apps Script 服務，載入 apps-script/*.gs，
// 匯入初始資料後實際呼叫 doGet / doPost。
// 執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

// 2026-10-01 10:00 台北時間 = 02:00 UTC
const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function findDuty(env, from, to, predicate) {
  return env.get({ action: 'getEvents', from, to }).data.duties.find(predicate);
}

test('ping 回傳台北時間的今天', () => {
  // 2026-10-01 23:30 UTC = 台北 10/2 07:30
  const env = createEnv(Date.UTC(2026, 9, 1, 23, 30));
  const r = env.get({ action: 'ping' });
  assert.equal(r.ok, true);
  assert.equal(r.data.today, '2026-10-02');
});

test('getEvents 回傳區間內勤務與每日人數，不含名字', () => {
  const env = createEnv(OCT_1);
  const r = env.get({ action: 'getEvents', from: '2026-11-01', to: '2026-11-30' });
  assert.equal(r.ok, true);
  const team = r.data.duties.find(d => d.name === '12人小組輪值');
  assert.equal(Object.keys(team.days).length, 8);
  assert.equal(team.positions.length, 4);
  assert.equal(team.days['2026-11-08'].shortage, 10);
  assert.ok(!JSON.stringify(r).includes('姓名'));
  const announce = r.data.duties.find(d => d.mode === '公告型');
  assert.deepEqual(announce.days, {});
});

test('getEvents 只截取區間內的天數', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-10', '2026-11-12', d => d.name === '12人小組輪值');
  assert.deepEqual(Object.keys(team.days), ['2026-11-10', '2026-11-11', '2026-11-12']);
});

test('getEvents 日期格式錯誤', () => {
  const env = createEnv(OCT_1);
  const r = env.get({ action: 'getEvents', from: '2026/11/01', to: '2026-11-30' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_REQUEST');
});

test('報名成功後，詳情頁看得到名字、人數更新、寫入操作紀錄', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const cook = team.positions.find(p => p.name === '烹飪');

  const r = env.post({
    action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08', '2026-11-09'],
    entries: [{ name: ' 測試甲　' }, { name: '測試乙' }, { name: '測試丙', identity: '壇辦', accompany: true }]
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.created.length, 6);
  assert.equal(r.data.days['2026-11-08'].counts[cook.id], 2);

  const detail = env.get({ action: 'getDuty', id: team.id }).data;
  const names = detail.signups.filter(s => s.date === '2026-11-08').map(s => s.name).sort();
  assert.deepEqual(names, ['測試丙', '測試乙', '測試甲'].sort());
  assert.equal(detail.days['2026-11-08'].total, 2);
  assert.equal(env.sheets['操作紀錄'].data.length, 1 + 6);
  assert.match(env.sheets['操作紀錄'].data[1][3], /^測試甲（道親）｜2026-11-08｜12人小組輪值｜烹飪$/);
});

test('報名寫入身分欄（報名分頁最後一欄），操作紀錄含身分', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const r = env.post({
    action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'],
    entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '壇辦', accompany: true }]
  });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const rows = env.sheets['報名'].data;
  assert.equal(rows[0][10], '身分');
  assert.deepEqual(rows.slice(1).map(x => [x[4], x[10], x[5]]), [['測試甲', '壇辦', '否'], ['測試乙', '壇辦', '是']]);
  assert.match(env.sheets['操作紀錄'].data[2][3], /^測試乙（壇辦・陪同）｜/);
});

test('沒選身分的報名被擋', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const r = env.postRaw(JSON.stringify({
    action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲' }]
  }));
  assert.equal(r.ok, false);
  assert.match(r.error.details[0].message, /請選擇身分/);
  assert.equal(env.sheets['報名'].data.length, 1);
});

test('同一勤務同一天報第二個了愿項目被擋，整批不寫入', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const [cook, clean] = team.positions;
  env.post({ action: 'signup', dutyId: team.id, positionId: cook.id, dates: ['2026-11-08'], entries: [{ name: '測試甲' }] });

  const before = env.sheets['報名'].data.length;
  const r = env.post({
    action: 'signup', dutyId: team.id, positionId: clean.id, dates: ['2026-11-08'],
    entries: [{ name: '測試乙' }, { name: '測試甲' }]
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION');
  assert.equal(r.error.details[0].name, '測試甲');
  assert.equal(env.sheets['報名'].data.length, before);
});

test('不同勤務同一天可以各報一個', () => {
  const env = createEnv(OCT_1);
  const day = '2026-10-24';
  const duties = env.get({ action: 'getEvents', from: day, to: day }).data.duties.filter(d => d.mode === '報名型');
  assert.ok(duties.length >= 2);
  duties.slice(0, 2).forEach(d => {
    const r = env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: [day], entries: [{ name: '測試甲' }] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  });
});

test('彌勒山志工輪值最多 2 人，第 3 人被擋，陪同仍可加', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const base = { action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'] };
  assert.equal(env.post({ ...base, entries: [{ name: '測試甲' }, { name: '測試乙' }] }).ok, true);
  const third = env.post({ ...base, entries: [{ name: '測試丙' }] });
  assert.equal(third.ok, false);
  assert.match(third.error.details[0].message, /已額滿/);
  assert.equal(env.post({ ...base, entries: [{ name: '測試丙', identity: '壇辦', accompany: true }] }).ok, true);
  assert.equal(findDuty(env, '2026-10-13', '2026-10-13', d => d.id === v.id).days['2026-10-13'].full, true);
});

test('勤務前一天可以報名，當天不行（台北時間換日）', () => {
  const env = createEnv(Date.UTC(2026, 9, 12, 15, 30)); // 台北 10/12 23:30
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const base = { action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲' }] };
  assert.equal(env.post(base).ok, true);

  // 台北 10/13 00:30（UTC 10/12 16:30）起就是勤務當天
  env.clock.now = Date.UTC(2026, 9, 12, 16, 30);
  const r = env.post({ ...base, entries: [{ name: '測試乙' }] });
  assert.equal(r.ok, false);
  assert.match(r.error.details[0].message, /勤務當天不能報名/);
});

test('公告型勤務：詳情回傳輪值組資訊，不能報名', () => {
  const env = createEnv(OCT_1);
  const groups = env.sheets['分組'].data;
  const row = groups.find(r => r[0] === '拜香輪值組' && r[1] === '第五組（青年組）');
  row[2] = '測試組長'; row[3] = '測試佐理'; row[4] = '測試甲、測試乙，測試丙';

  const a = findDuty(env, '2026-10-10', '2026-10-10', d => d.mode === '公告型');
  const detail = env.get({ action: 'getDuty', id: a.id }).data;
  assert.deepEqual(detail.groupInfo, {
    name: '第五組（青年組）', leader: '測試組長', assistant: '測試佐理', members: ['測試甲', '測試乙', '測試丙']
  });
  const r = env.post({ action: 'signup', dutyId: a.id, positionId: 'x', dates: ['2026-10-10'], entries: [{ name: '測試甲' }] });
  assert.equal(r.ok, false);
});

test('searchMembers 沒輸入字就不回傳任何名字', () => {
  const env = createEnv(OCT_1);
  env.sheets['成員'].data.push(['測試甲', '道親', '第1組', '', '', '', '是']);
  assert.deepEqual(env.get({ action: 'searchMembers' }).data.members, []);
  assert.deepEqual(env.get({ action: 'searchMembers', q: ' 　' }).data.members, []);
});

test('searchMembers 只回相符者的姓名與組別，略過停用者', () => {
  const env = createEnv(OCT_1);
  const m = env.sheets['成員'].data;
  m.push(['　測試甲 ', '道親', '第1組', '第2組', '第一組', '備註內容', '是']);
  m.push(['測試乙', '壇辦', '', '', '', '', '否']);
  m.push(['範例丙', '道親', '', '', '', '', '是']);
  const r = env.get({ action: 'searchMembers', q: '測試' });
  assert.deepEqual(r.data.members, [{ name: '測試甲', temple: '', dup: false, identity: '道親', groups: { '勤務了愿組': '第1組', '打掃組': '第2組', '拜香輪值組': '第一組' } }]);
  assert.ok(!JSON.stringify(r).includes('備註內容'));
});

test('searchMembers 負責組組員排最前面，最多 10 筆', () => {
  const env = createEnv(OCT_1);
  const m = env.sheets['成員'].data;
  for (let i = 0; i < 12; i++) m.push(['測試' + i, '道親', '第1組', '', '', '', '是']);
  m.push(['測試組員', '道親', '第3組', '', '', '', '是']);
  const r = env.get({ action: 'searchMembers', q: '測試', groupType: '勤務了愿組', group: '第3組' });
  assert.equal(r.data.members.length, 10);
  assert.equal(r.data.members[0].name, '測試組員');
});

test('未知 action 與錯誤 JSON', () => {
  const env = createEnv(OCT_1);
  assert.equal(env.get({ action: 'nope' }).error.code, 'BAD_REQUEST');
  assert.equal(env.post({ action: 'nope' }).error.code, 'BAD_REQUEST');
  const bad = env.postRaw('{not json');
  assert.equal(bad.error.code, 'BAD_REQUEST');
  assert.match(bad.error.message, /JSON/);
});

// ---------- 取消、改期 ----------

function signupOne(env, duty, positionId, date, entry) {
  const r = env.post({ action: 'signup', dutyId: duty.id, positionId, dates: [date], entries: [entry || { name: '測試甲' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.data.created[0].id;
}

function signupRow(env, id) {
  const rows = env.sheets['報名'].data;
  const h = rows[0];
  const row = rows.find(r => r[0] === id);
  return Object.fromEntries(h.map((k, i) => [k, row[i]]));
}

test('取消：狀態改為已取消、人數更新、寫入操作紀錄（含前一版資料）', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const id = signupOne(env, team, team.positions[0].id, '2026-11-08');

  const r = env.post({ action: 'cancel', signupId: id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.days['2026-11-08'].total, 0);
  assert.equal(signupRow(env, id)['狀態'], '已取消');
  const log = env.sheets['操作紀錄'].data.at(-1);
  assert.equal(log[1], '取消');
  assert.equal(log[2], id);
  assert.match(log[3], /^測試甲（道親）｜2026-11-08｜12人小組輪值｜烹飪$/);
  assert.equal(JSON.parse(log[4])['狀態'], '有效');
  assert.equal(env.get({ action: 'getDuty', id: team.id }).data.signups.length, 0);
});

test('取消：已取消的不能再取消；找不到的報名', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const id = signupOne(env, team, team.positions[0].id, '2026-11-08');
  env.post({ action: 'cancel', signupId: id });
  assert.equal(env.post({ action: 'cancel', signupId: id }).error.code, 'ALREADY');
  assert.equal(env.post({ action: 'cancel', signupId: 'S-nope' }).error.code, 'NOT_FOUND');
});

test('取消、改期：勤務當天（含）之後不能自己做', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v, v.positions[0].id, '2026-10-13');
  env.clock.now = Date.UTC(2026, 9, 12, 16, 30); // 台北 10/13 00:30（當天）
  const c = env.post({ action: 'cancel', signupId: id });
  assert.equal(c.error.code, 'FORBIDDEN');
  assert.match(c.error.message, /請聯絡管理者/);
  const later = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '彌勒山志工輪值');
  const m = env.post({ action: 'reschedule', signupId: id, dutyId: later.id, date: '2026-10-24', positionId: later.positions[0].id });
  assert.equal(m.error.code, 'FORBIDDEN');
  assert.equal(signupRow(env, id)['狀態'], '有效');
});

test('改期到同名勤務的其他日期：原報名取消、新報名保留姓名身分陪同、寫入操作紀錄', () => {
  const env = createEnv(OCT_1);
  const v1 = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const v2 = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v1, v1.positions[0].id, '2026-10-13', { name: '測試甲', identity: '壇辦', accompany: true });

  const r = env.post({ action: 'reschedule', signupId: id, dutyId: v2.id, date: '2026-10-24', positionId: v2.positions[0].id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(signupRow(env, id)['狀態'], '已取消');
  const n = signupRow(env, r.data.signupId);
  assert.deepEqual([n['勤務ID'], n['日期'], n['姓名'], n['身分'], n['陪同'], n['狀態']], [v2.id, '2026-10-24', '測試甲', '壇辦', '是', '有效']);
  const log = env.sheets['操作紀錄'].data.at(-1);
  assert.equal(log[1], '改期');
  assert.equal(log[2], r.data.signupId);
  assert.match(log[3], /2026-10-13｜彌勒山志工輪值｜志工 → 2026-10-24｜志工$/);
  const prev = JSON.parse(log[4]);
  assert.equal(prev.from['報名ID'], id);
  assert.equal(prev.toSignupId, r.data.signupId);
});

test('改期：多天勤務換天、同一天換了愿項目都可以', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const [cook, clean] = team.positions;
  const id = signupOne(env, team, cook.id, '2026-11-08');
  const sameDay = env.post({ action: 'reschedule', signupId: id, dutyId: team.id, date: '2026-11-08', positionId: clean.id });
  assert.equal(sameDay.ok, true, JSON.stringify(sameDay.error));
  const otherDay = env.post({ action: 'reschedule', signupId: sameDay.data.signupId, dutyId: team.id, date: '2026-11-10', positionId: clean.id });
  assert.equal(otherDay.ok, true, JSON.stringify(otherDay.error));
  assert.equal(otherDay.data.from.days['2026-11-08'].total, 0);
  assert.equal(otherDay.data.to.days['2026-11-10'].counts[clean.id], 1);
});

test('改期：不同名勤務、沒有變更、新日期額滿或重複時整筆不動', () => {
  const env = createEnv(OCT_1);
  const v1 = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const v2 = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '彌勒山志工輪值');
  const other = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '志工團輪值：統班');
  const id = signupOne(env, v1, v1.positions[0].id, '2026-10-13');

  assert.match(env.post({ action: 'reschedule', signupId: id, dutyId: other.id, date: '2026-10-24', positionId: other.positions[0].id }).error.message, /同一個勤務/);
  assert.match(env.post({ action: 'reschedule', signupId: id, dutyId: v1.id, date: '2026-10-13', positionId: v1.positions[0].id }).error.message, /沒有變更/);

  signupOne(env, v2, v2.positions[0].id, '2026-10-24', { name: '測試乙' });
  signupOne(env, v2, v2.positions[0].id, '2026-10-24', { name: '測試丙' });
  const full = env.post({ action: 'reschedule', signupId: id, dutyId: v2.id, date: '2026-10-24', positionId: v2.positions[0].id });
  assert.equal(full.error.code, 'VALIDATION');
  assert.match(full.error.details[0].message, /額滿/);
  assert.equal(signupRow(env, id)['狀態'], '有效');
  assert.equal(env.sheets['報名'].data.length, 1 + 3);
});

test('getSiblings：只列同名、未結束的勤務，日期從今天起', () => {
  const env = createEnv(Date.UTC(2026, 9, 20, 2)); // 台北 10/20
  const v = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '彌勒山志工輪值');
  const r = env.get({ action: 'getSiblings', id: v.id });
  assert.equal(r.ok, true);
  assert.ok(r.data.duties.every(d => d.name === '彌勒山志工輪值' && d.end >= '2026-10-20'));
  assert.equal(r.data.duties[0].start, '2026-10-24');
  assert.equal(r.data.duties.length, 14); // 共 16 次，扣掉 10/1、10/13
});

// ---------- 管理後台 ----------

function adminLogin(env) {
  const r = env.post({ action: 'adminLogin', password: 'test-pass' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r.data.token;
}

function logRows(env) {
  return env.sheets['操作紀錄'].data.slice(1);
}

test('管理登入：密碼錯誤、成功發通行碼、沒有通行碼不能用、連錯 10 次鎖住', () => {
  const env = createEnv(OCT_1);
  assert.equal(env.post({ action: 'adminLogin', password: 'wrong' }).error.code, 'UNAUTHORIZED');
  assert.equal(env.post({ action: 'adminRecent' }).error.code, 'UNAUTHORIZED');
  assert.equal(env.post({ action: 'adminRecent', token: 'fake' }).error.code, 'UNAUTHORIZED');
  const token = adminLogin(env);
  assert.equal(env.post({ action: 'adminRecent', token }).ok, true);
  env.post({ action: 'adminLogout', token });
  assert.equal(env.post({ action: 'adminRecent', token }).error.code, 'UNAUTHORIZED');

  for (let i = 0; i < 10; i++) env.post({ action: 'adminLogin', password: 'wrong' });
  const locked = env.post({ action: 'adminLogin', password: 'test-pass' });
  assert.equal(locked.error.code, 'LOCKED');
});

test('管理登入：一次只能一台裝置，新登入讓舊的自動登出', () => {
  const env = createEnv(OCT_1);
  const first = adminLogin(env);
  assert.equal(env.post({ action: 'adminPing', token: first }).ok, true);
  const second = adminLogin(env);
  const kicked = env.post({ action: 'adminPing', token: first });
  assert.equal(kicked.error.code, 'UNAUTHORIZED');
  assert.match(kicked.error.message, /其他裝置/);
  assert.equal(env.post({ action: 'adminRecent', token: second }).ok, true);
  // 被擠掉的裝置按登出，不影響目前登入的那台
  env.post({ action: 'adminLogout', token: first });
  assert.equal(env.post({ action: 'adminPing', token: second }).ok, true);
});

test('管理名單：含身分與組長電話；一般 API 不回傳電話', () => {
  const env = createEnv(OCT_1);
  const groups = env.sheets['分組'].data;
  const g = groups.find(r => r[0] === '勤務了愿組' && r[1] === '第2組');
  g[2] = '測試組長'; g[5] = '0900-000-000';
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  signupOne(env, v, v.positions[0].id, '2026-10-13', { name: '測試甲', identity: '壇辦' });

  const token = adminLogin(env);
  const a = env.post({ action: 'adminDuty', token, id: v.id }).data;
  assert.deepEqual(a.groupContact, { name: '第2組', leader: '測試組長', phone: '0900-000-000' });
  assert.equal(a.signups[0].identity, '壇辦');
  assert.ok(!JSON.stringify(env.get({ action: 'getDuty', id: v.id })).includes('0900'));
  assert.ok(!JSON.stringify(env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-10-31' })).includes('0900'));
});

test('管理者可以取消當天（含）之後的報名', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v, v.positions[0].id, '2026-10-13');
  env.clock.now = Date.UTC(2026, 9, 13, 2); // 台北 10/13
  const token = adminLogin(env);
  assert.equal(env.post({ action: 'cancel', signupId: id }).error.code, 'FORBIDDEN');
  const r = env.post({ action: 'adminCancel', token, signupId: id });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.match(logRows(env).at(-1)[3], /（管理者）$/);
});

test('操作紀錄：新到舊、可還原的才標示可還原', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v, v.positions[0].id, '2026-10-13');
  env.post({ action: 'cancel', signupId: id });
  const token = adminLogin(env);
  const r = env.post({ action: 'adminLogs', token }).data;
  assert.equal(r.total, 2);
  assert.deepEqual(r.logs.map(l => l.action), ['取消', '報名']);
  assert.ok(r.logs.every(l => l.restorable));
});

test('還原報名＝取消該筆；不能重複還原；還原也寫入紀錄', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v, v.positions[0].id, '2026-10-13');
  const token = adminLogin(env);
  const log = env.post({ action: 'adminLogs', token }).data.logs[0];
  const r = env.post({ action: 'adminRestore', token, row: log.row, signupId: log.signupId });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(signupRow(env, id)['狀態'], '已取消');
  assert.equal(env.post({ action: 'adminRestore', token, row: log.row, signupId: log.signupId }).error.code, 'ALREADY');
  const logs = env.post({ action: 'adminLogs', token }).data.logs;
  assert.equal(logs[0].action, '還原');
  assert.equal(logs[0].restorable, false);
  assert.ok(logs[1].restoredAt);
});

test('還原取消＝恢復該筆；超過名額時照樣恢復並回傳警告', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const pid = v.positions[0].id;
  const id = signupOne(env, v, pid, '2026-10-13', { name: '測試甲' });
  env.post({ action: 'cancel', signupId: id });
  signupOne(env, v, pid, '2026-10-13', { name: '測試乙' });
  signupOne(env, v, pid, '2026-10-13', { name: '測試丙' }); // 名額 2 已滿
  const token = adminLogin(env);
  const cancelLog = env.post({ action: 'adminLogs', token }).data.logs.find(l => l.action === '取消');
  const r = env.post({ action: 'adminRestore', token, row: cancelLog.row, signupId: cancelLog.signupId });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(signupRow(env, id)['狀態'], '有效');
  assert.equal(r.data.warnings.length, 1);
  assert.match(r.data.warnings[0], /額滿/);
  assert.match(logRows(env).at(-1)[3], /警告/);
});

test('還原改期＝取消新的一筆、恢復原本那筆', () => {
  const env = createEnv(OCT_1);
  const v1 = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const v2 = findDuty(env, '2026-10-24', '2026-10-24', d => d.name === '彌勒山志工輪值');
  const id = signupOne(env, v1, v1.positions[0].id, '2026-10-13');
  const moved = env.post({ action: 'reschedule', signupId: id, dutyId: v2.id, date: '2026-10-24', positionId: v2.positions[0].id }).data.signupId;
  const token = adminLogin(env);
  const log = env.post({ action: 'adminLogs', token }).data.logs.find(l => l.action === '改期');
  const r = env.post({ action: 'adminRestore', token, row: log.row, signupId: log.signupId });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(signupRow(env, id)['狀態'], '有效');
  assert.equal(signupRow(env, moved)['狀態'], '已取消');
  assert.deepEqual(r.data.warnings, []);
});

test('還原時核對報名ID，避免對錯列', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  signupOne(env, v, v.positions[0].id, '2026-10-13');
  const token = adminLogin(env);
  const log = env.post({ action: 'adminLogs', token }).data.logs[0];
  assert.equal(env.post({ action: 'adminRestore', token, row: log.row, signupId: 'S-other' }).error.code, 'NOT_FOUND');
});

test('指定日期名單：各了愿項目的名字與陪同；公告型附輪值組、不含電話', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-09', '2026-11-09', d => d.name === '12人小組輪值');
  signupOne(env, team, team.positions[0].id, '2026-11-09', { name: '測試甲' });
  signupOne(env, team, team.positions[0].id, '2026-11-09', { name: '測試乙', identity: '壇辦', accompany: true });
  const token = adminLogin(env);
  const r = env.post({ action: 'adminDay', token, date: '2026-11-09' }).data;
  const t = r.duties.find(d => d.name === '12人小組輪值');
  assert.deepEqual(t.positions[0].people, [{ name: '測試甲', accompany: false }, { name: '測試乙', accompany: true }]);
  const notice = r.duties.find(d => d.mode === '公告型');
  assert.equal(notice.groupInfo.name, '第三組');
  assert.ok(!('phone' in notice.groupInfo));
});

// ---------- 讀取快取 ----------

test('快取：直接改試算表後，onEdit 清快取才讀到新資料；報名後自動更新', () => {
  const env = createEnv(OCT_1);
  const before = findDuty(env, '2026-10-18', '2026-10-18', d => d.name === '捐血低碳蔬食推廣活動');
  const row = env.sheets['勤務'].data.find(r => r[0] === before.id);
  row[1] = '捐血活動（改名）';
  assert.equal(findDuty(env, '2026-10-18', '2026-10-18', d => d.id === before.id).name, '捐血低碳蔬食推廣活動'); // 仍是快取
  env.onEdit();
  assert.equal(findDuty(env, '2026-10-18', '2026-10-18', d => d.id === before.id).name, '捐血活動（改名）');

  signupOne(env, before, before.positions[0].id, '2026-10-18');
  assert.equal(findDuty(env, '2026-10-18', '2026-10-18', d => d.id === before.id).days['2026-10-18'].total, 1);
});

test('快取：keepWarm 重新讀取；大表切塊存取正確', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const h = env.sheets['報名'].data[0];
  for (let i = 0; i < 800; i++) {
    const r = Object.fromEntries(h.map(k => [k, '']));
    Object.assign(r, { '報名ID': 'S-big-' + i, '勤務ID': v.id, '日期': '2026-10-13', '了愿項目ID': v.positions[0].id,
      '姓名': '測試' + i, '陪同': '是', '出席': '出席', '狀態': '有效', '身分': '壇辦', '建立時間': '2026-10-01 10:00:00', '更新時間': '2026-10-01 10:00:00' });
    env.sheets['報名'].data.push(h.map(k => r[k]));
  }
  env.keepWarm();
  const d = env.get({ action: 'getDuty', id: v.id }).data;
  assert.equal(d.signups.length, 800);
  assert.equal(d.signups[799].name, '測試799');
});

// ---------- 管理者聯絡人、負責組組長 ----------

test('「請聯絡管理者」接上管理者聯絡人（指令碼屬性 ADMIN_CONTACT）', () => {
  const env = createEnv(Date.UTC(2026, 9, 13, 2)); // 台北 10/13
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲' }] });
  assert.match(r.error.details[0].message, /請聯絡管理者測試管理者$/);
  assert.equal(env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.contact, '測試管理者');
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.contact, '測試管理者');
});

test('勤務資料含負責組的組長或召集人，不含電話', () => {
  const env = createEnv(OCT_1);
  const g = env.sheets['分組'].data.find(r => r[0] === '勤務了愿組' && r[1] === '第1組');
  g[2] = '測試組長'; g[5] = '0900-000-000';
  const ev = env.get({ action: 'getEvents', from: '2026-10-01', to: '2026-10-01' });
  const v = ev.data.duties.find(d => d.name === '彌勒山志工輪值');
  assert.equal(v.groupLeader, '測試組長');
  assert.ok(!JSON.stringify(ev).includes('0900'));
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.groupLeader, '測試組長');
  const noGroup = ev.data.duties.find(d => !d.group);
  if (noGroup) assert.equal(noGroup.groupLeader, '');
});

test('成員名單上已登記身分的人，報名時身分以名單為準', () => {
  const env = createEnv(OCT_1);
  const sheet = env.sheets['成員'].data;
  sheet.push(['測試甲', '壇辦', '', '', '', '', '是'], ['測試乙', '', '', '', '', '', '是']);
  env.onEdit();
  const duty = findDuty(env, '2026-10-13', '2026-10-13', (d) => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: duty.id, positionId: duty.positions[0].id, dates: ['2026-10-13'],
    entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '未求道' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.created.map((c) => [c.name, c.identity]), [['測試甲', '壇辦'], ['測試乙', '未求道']]);
});

// ---------- 我的報名 ----------

test('我的報名：只列完全同名、今天起、有效的報名，依日期排序；名字太短不查', () => {
  const env = createEnv(OCT_1);
  const team = findDuty(env, '2026-11-08', '2026-11-08', d => d.name === '12人小組輪值');
  const cook = team.positions.find(p => p.name === '烹飪');
  const later = signupOne(env, team, cook.id, '2026-11-09', { name: '測試甲' });
  signupOne(env, team, cook.id, '2026-11-08', { name: '測試甲' });
  signupOne(env, team, cook.id, '2026-11-08', { name: '測試丁' });
  const cancelled = signupOne(env, team, cook.id, '2026-11-10', { name: '測試甲' });
  env.post({ action: 'cancel', signupId: cancelled });

  const r = env.post({ action: 'mySignups', name: ' 測試 甲 ' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.items.map(i => i.date), ['2026-11-08', '2026-11-09']);
  const item = r.data.items.find(i => i.signupId === later);
  assert.equal(item.dutyName, '12人小組輪值');
  assert.equal(item.positionName, '烹飪');
  assert.equal(item.canChange, true);
  assert.equal('identity' in item, false);

  assert.equal(env.post({ action: 'mySignups', name: '甲' }).error.code, 'BAD_REQUEST');
});

// ---------- 開網站一次打包 ----------

test('getBundle：行事曆資料＋今天起 30 天內勤務的詳情（與 getDuty 相同）', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  signupOne(env, v, v.positions[0].id, '2026-10-13', { name: '測試甲' });
  const r = env.get({ action: 'getBundle', from: '2025-12-25', to: '2027-01-07' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const events = env.get({ action: 'getEvents', from: '2025-12-25', to: '2027-01-07' }).data;
  assert.equal(r.data.duties.length, events.duties.length);
  assert.deepEqual(r.data.details[v.id], env.get({ action: 'getDuty', id: v.id }).data);
  // 30 天以後、已過去的不含詳情
  Object.values(r.data.details).forEach((d) => {
    assert.ok(d.start <= '2026-10-30' && d.end >= '2026-10-01', d.name + ' ' + d.start);
  });
  assert.ok(Object.keys(r.data.details).length < events.duties.length);
});

// ---------- 從照片產生草稿（Gemini，測試用假的回應） ----------

test('從照片產生草稿：要登入、檢查照片、回傳草稿；模型不存在換下一個；次數太多回 AI_LIMIT', () => {
  const env = createEnv(OCT_1);
  const img = { mime: 'image/jpeg', data: 'AAAA' };
  assert.equal(env.post({ action: 'adminDraftFromImages', images: [img] }).error.code, 'UNAUTHORIZED');
  const token = adminLogin(env);
  assert.equal(env.post({ action: 'adminDraftFromImages', token, images: [] }).error.code, 'BAD_REQUEST');
  assert.equal(env.post({ action: 'adminDraftFromImages', token, images: [{ mime: 'text/plain', data: 'x' }] }).error.code, 'BAD_REQUEST');

  const ok = env.post({ action: 'adminDraftFromImages', token, images: [img], hint: '十月的' });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(ok.data.duties[0].name, '測試活動');
  const sent = JSON.parse(env.fakeAi.calls[0].opts.payload);
  assert.equal(sent.contents[0].parts[1].inline_data.data, 'AAAA');
  assert.match(sent.contents[0].parts[0].text, /十月的/);
  assert.equal(env.fakeAi.calls[0].opts.headers['x-goog-api-key'], 'test-key');
  // 沒有寫入任何勤務
  assert.equal(env.sheets['勤務'].data.some(r => r[1] === '測試活動'), false);

  let n = 0;
  env.setFetch(() => (n++ === 0 ? { code: 404, body: {} } : { code: 200, body: { candidates: [{ content: { parts: [{ text: '[{"name":"第二個模型"}]' }] } }] } }));
  const second = env.post({ action: 'adminDraftFromImages', token, images: [img] });
  assert.equal(second.data.duties[0].name, '第二個模型');

  // 太忙（503）：重試一次，還是忙就換下一個模型
  const seen = [];
  env.setFetch((url) => { seen.push(url.match(/models\/([^:]+)/)[1]); return seen.length <= 2 ? { code: 503, body: {} } : { code: 200, body: { candidates: [{ content: { parts: [{ text: '[{"name":"備用模型"}]' }] } }] } }; });
  assert.equal(env.post({ action: 'adminDraftFromImages', token, images: [img] }).data.duties[0].name, '備用模型');
  assert.deepEqual(seen, ['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-flash-latest']);
  // 預設的都不存在：問 Google 有哪些 Flash 模型，挑新的（不是 lite 的優先）
  const tried = [];
  env.setFetch((url) => {
    if (/models\?/.test(url)) return { code: 200, body: { models: [
      { name: 'models/gemini-4.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-4.0-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] }
    ] } };
    const m = url.match(/models\/([^:]+)/)[1];
    tried.push(m);
    return m === 'gemini-4.0-flash' ? { code: 200, body: { candidates: [{ content: { parts: [{ text: '[{"name":"新模型"}]' }] } }] } } : { code: 404, body: {} };
  });
  const listedRes = env.post({ action: 'adminDraftFromImages', token, images: [img] });
  assert.equal(listedRes.data.duties[0].name, '新模型');
  assert.equal(listedRes.data.model, 'gemini-4.0-flash');
  assert.deepEqual(tried, ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-4.0-flash']);
  env.setFetch(() => ({ code: 503, body: {} }));
  assert.match(env.post({ action: 'adminDraftFromImages', token, images: [img] }).error.message, /太忙/);

  // 次數太多（429）：換下一個模型（免費額度每個模型分開算）
  let k = 0;
  env.setFetch((url) => (/models\?/.test(url) ? { code: 200, body: { models: [] } } : k++ === 0 ? { code: 429, body: {} } : { code: 200, body: { candidates: [{ content: { parts: [{ text: '[{"name":"換模型成功"}]' }] } }] } }));
  assert.equal(env.post({ action: 'adminDraftFromImages', token, images: [img] }).data.duties[0].name, '換模型成功');
  env.setFetch((url) => (/models\?/.test(url) ? { code: 200, body: { models: [] } } : { code: 429, body: 'Quota exceeded for metric generate_content_free_tier_requests, limit: 20, PerDay' }));
  const day = env.post({ action: 'adminDraftFromImages', token, images: [img] });
  assert.equal(day.error.code, 'AI_LIMIT');
  assert.match(day.error.message, /今天/);
  env.setFetch((url) => (/models\?/.test(url) ? { code: 200, body: { models: [] } } : { code: 429, body: 'PerMinute' }));
  assert.match(env.post({ action: 'adminDraftFromImages', token, images: [img] }).error.message, /一分鐘/);
  env.setFetch(() => ({ code: 200, body: { candidates: [{ content: { parts: [{ text: '看不懂' }] } }] } }));
  assert.equal(env.post({ action: 'adminDraftFromImages', token, images: [img] }).error.code, 'AI');
});

// ---------- 讀取回應快取 ----------

test('讀取快取：報名後勤務詳情與打包立刻更新；直接改試算表（不觸發 onEdit）由 keepWarm 發現', () => {
  const env = createEnv(OCT_1);
  const v = findDuty(env, '2026-10-13', '2026-10-13', d => d.name === '彌勒山志工輪值');
  const w = { action: 'getBundle', from: '2025-12-25', to: '2027-01-07' };
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.signups.length, 0);
  assert.equal(env.get(w).data.details[v.id].signups.length, 0);
  signupOne(env, v, v.positions[0].id, '2026-10-13', { name: '測試甲' });
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.signups.length, 1);
  assert.equal(env.get(w).data.details[v.id].signups.length, 1);

  // 直接改勤務名稱（模擬插入整列等不會觸發 onEdit 的修改）
  const rows = env.sheets['勤務'].data;
  const row = rows.find(r => r[0] === v.id);
  row[1] = '彌勒山志工輪值（改）';
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.name, '彌勒山志工輪值'); // 還是快取
  env.keepWarm();
  assert.equal(env.get({ action: 'getDuty', id: v.id }).data.name, '彌勒山志工輪值（改）');
});
