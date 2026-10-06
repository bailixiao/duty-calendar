// 自動統計表。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-24' }).data.duties;
  return { env, call, ev };
}

test('adminStats：只算今天以前、出席、非陪同；陪同、未填身分、未到分開記', () => {
  const { env, call, ev } = setup();
  const vol = ev.find((d) => d.name === '彌勒山志工輪值' && d.start === '2026-10-13');
  const clean = ev.find((d) => d.name === '宏宗大掃除');
  const pid = vol.positions[0].id;
  env.post({ action: 'signup', dutyId: vol.id, positionId: pid, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '道親' }, { name: '測試丙', identity: '壇辦', accompany: true }] });
  const later = env.post({ action: 'signup', dutyId: clean.id, positionId: clean.positions[0].id, dates: ['2026-10-24'], entries: [{ name: '測試丁', identity: '道親' }, { name: '測試戊', identity: '道親' }] });
  assert.equal(later.ok, true, JSON.stringify(later.error));

  env.clock.now = Date.UTC(2026, 9, 20, 2); // 10/20：10/24 還沒到
  let stats = call('adminStats').data;
  assert.equal(stats.events.length, 1);
  assert.deepEqual(stats.events[0].tan, ['測試甲']);
  assert.deepEqual(stats.events[0].dao, ['測試乙']);
  assert.deepEqual(stats.events[0].accompany, ['測試丙']);
  assert.equal(stats.events[0].series, '彌勒山志工輪值');

  env.clock.now = Date.UTC(2026, 9, 25, 2);
  const absent = later.data.created[1].id;
  call('adminSetAttendance', { signupId: absent, attend: '未到' });
  // 試算表直接改：身分清空 → 未填身分
  const sheet = env.sheets['報名'].data;
  const idCol = sheet[0].indexOf('身分');
  sheet.find((r) => r[4] === '測試丁')[idCol] = '';
  env.onEdit();
  stats = call('adminStats').data;
  const e2 = stats.events.find((e) => e.dutyId === clean.id);
  assert.deepEqual(e2.unknown, ['測試丁']);
  assert.deepEqual(e2.dao, []);
  assert.equal(e2.absent, 1);
});

test('更新統計分頁：全年彙總、各季、每月明細；佔比用百分比格式；沒資料不會除以零', () => {
  const { env, call, ev } = setup();
  const vol = ev.find((d) => d.name === '彌勒山志工輪值' && d.start === '2026-10-13');
  env.post({ action: 'signup', dutyId: vol.id, positionId: vol.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '壇辦' }, { name: '測試乙', identity: '道親' }] });
  env.clock.now = Date.UTC(2026, 9, 20, 2);

  const r = call('adminUpdateStatsSheet', { year: 2026 });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const s = env.sheets['統計'];
  const rows = s.data;
  assert.equal(rows[0][0], '115 年勤務統計（2026）');
  const oct = rows.find((x) => x[0] === '115 年 10 月');
  assert.deepEqual(oct.slice(1, 9), [1, 1, 1, 0, 2, 0.5, 0, 2]);
  const jan = rows.find((x) => x[0] === '115 年 1 月');
  assert.equal(jan[6], 0, '沒資料的月份佔比是 0');
  const total = rows.find((x) => x[0] === '全年合計');
  assert.equal(total[5], 2);
  assert.ok(rows.some((x) => /^第 4 季/.test(x[0]) && x[5] === 2));
  const detail = rows.find((x) => x[0] === '2026-10-13');
  assert.deepEqual([detail[1], detail[3], detail[4], detail[5], detail[6], detail[7]], ['彌勒山志工輪值', '測試甲', 1, '測試乙', 1, 0.5]);
  // 佔比欄是百分比格式，日期是純文字
  const octIndex = rows.indexOf(oct);
  assert.equal(s.formats[octIndex][6], '0%');
  assert.equal(s.formats[rows.indexOf(detail)][0], '@');
  assert.ok(rows.flat().every((v) => !/#DIV\/0/.test(String(v))));
  assert.ok(call('adminStats').data.sheetUpdatedAt);
});

test('匯入歷史資料：建立過去的勤務與出席、陪同不算人數、統計算得到；重複匯入會略過', () => {
  const { env, call } = setup();
  const events = [
    { date: '2026-03-05', name: '宏宗打掃', nature: '勤務', tan: ['測試甲', ' 測試乙'], dao: ['測試丙'], accompany: ['測試丁'] },
    { date: '2025-08-24', end: '2025-08-31', name: '12人小組', nature: '勤務', tan: ['測試甲'], dao: [], accompany: [] }
  ];
  assert.equal(env.post({ action: 'adminImportHistory', events }).error.code, 'UNAUTHORIZED');
  assert.equal(call('adminImportHistory', { events: [{ date: '2026/3/5', name: 'x' }] }).error.code, 'VALIDATION');

  const r = call('adminImportHistory', { events, source: '測試檔' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data, { duties: 2, signups: 5, skipped: 0, updated: 0 });

  const stats = call('adminStats').data.events;
  const mar = stats.find((e) => e.date === '2026-03-05');
  assert.deepEqual([mar.tan, mar.dao, mar.accompany, mar.short], [['測試甲', '測試乙'], ['測試丙'], ['測試丁'], 0]);
  const multi = stats.find((e) => e.date === '2025-08-24');
  assert.deepEqual(multi.tan, ['測試甲']);
  assert.ok(!stats.some((e) => e.date === '2025-08-25'), '多天勤務每人只記第一天');

  const again = call('adminImportHistory', { events });
  assert.deepEqual(again.data, { duties: 0, signups: 0, skipped: 2, updated: 0 });
  assert.match(env.sheets['操作紀錄'].data.slice(-2)[0][3], /測試檔｜匯入 2 場、5 筆出席/);
});

test('匯入歷史資料：同一批同名同日的兩場合併，不會漏人', () => {
  const { call } = setup();
  const r = call('adminImportHistory', { events: [
    { date: '2026-03-05', name: '宏宗打掃', tan: ['測試甲'], dao: [], accompany: [] },
    { date: '2026-03-05', name: '宏宗打掃', tan: ['測試甲', '測試乙'], dao: ['測試丙'], accompany: [] }
  ] });
  assert.deepEqual(r.data, { duties: 1, signups: 3, skipped: 0, updated: 0 });
});

test('匯入歷史資料：不知道身分的人記為未填身分，統計看得到', () => {
  const { call } = setup();
  const r = call('adminImportHistory', { events: [{ date: '2026-03-06', name: '區中心打掃', tan: [], dao: ['測試甲'], unknown: ['測試乙'], accompany: [] }] });
  assert.equal(r.data.signups, 2);
  const e = call('adminStats').data.events.find((x) => x.date === '2026-03-06');
  assert.deepEqual(e.unknown, ['測試乙']);
});

test('重新匯入歷史資料：之前匯入的場次補上漏掉的人；不是歷史匯入的勤務照樣略過', () => {
  const { env, call } = setup();
  call('adminImportHistory', { events: [{ date: '2026-03-05', name: '宏宗打掃', tan: ['測試甲'], dao: [], accompany: [] }] });
  const vol = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties[0];
  const r = call('adminImportHistory', { events: [
    { date: '2026-03-05', name: '宏宗打掃', tan: ['測試甲'], dao: [], unknown: ['測試乙'], accompany: ['測試丙'] },
    { date: vol.start, name: vol.name, tan: ['測試丁'], dao: [], accompany: [] }
  ] });
  assert.deepEqual(r.data, { duties: 0, signups: 2, skipped: 1, updated: 1 });
  const e = call('adminStats').data.events.find((x) => x.date === '2026-03-05');
  assert.deepEqual([e.tan, e.unknown, e.accompany], [['測試甲'], ['測試乙'], ['測試丙']]);
});

test('未求道算進道親；報名的新名字自動加入成員（待確認），身分用報名時選的', () => {
  const { env, call, ev } = setup();
  const vol = ev.find((d) => d.name === '彌勒山志工輪值' && d.start === '2026-10-13');
  const s = env.post({ action: 'signup', dutyId: vol.id, positionId: vol.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '未求道' }, { name: '測試乙', identity: '壇辦' }] });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  env.clock.now = Date.UTC(2026, 9, 20, 2);
  const e = call('adminStats').data.events[0];
  assert.deepEqual([e.dao, e.tan], [['測試甲'], ['測試乙']]);
  const m = call('adminMembers').data.members.find((x) => x.name === '測試甲');
  assert.deepEqual([m.identity, m.pending], ['未求道', true]);
  assert.equal(call('adminConfirmMembers', { rows: [{ row: m.row, original: m.name }] }).data.confirmed, 1);
  assert.equal(call('adminMembers').data.members.find((x) => x.name === '測試甲').pending, false);
});

test('教育：師資欄（只有教育存）、報名頁看得到；統計的課程堂次含沒人報名的課、未到的名字', () => {
  const { createEnv } = require('./env');
  const env = createEnv(Date.UTC(2026, 9, 20, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const c = call('adminCreateDuties', { duties: [
    { name: '讀經班', category: '教育', nature: '課程', start: '2026-10-07', positions: [{ name: '參加', min: '0' }], teachers: '測試甲，測試乙' },
    { name: '讀經班', category: '教育', nature: '課程', start: '2026-10-14', positions: [{ name: '參加', min: '0' }], teachers: '測試乙' },
    { name: '打掃', start: '2026-10-08', positions: [{ name: '打掃' }], teachers: '不該存' }
  ] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const [d1, d2, d3] = c.data.ids;
  assert.equal(env.get({ action: 'getDuty', id: d1 }).data.teachers, '測試甲、測試乙');
  assert.equal(env.get({ action: 'getDuty', id: d3 }).data.teachers, '');
  const pid = env.get({ action: 'getDuty', id: d1 }).data.positions[0].id;
  const a = call('adminAddAttendee', { dutyId: d1, positionId: pid, date: '2026-10-07', name: '王小明', identity: '道親' });
  call('adminAddAttendee', { dutyId: d1, positionId: pid, date: '2026-10-07', name: '李小華', identity: '道親' });
  call('adminSetAttendance', { signupId: a.data.signupId, attend: '未到' });
  const st = call('adminStats', {}).data;
  const sess = st.eduSessions.filter((s) => s.name === '讀經班');
  assert.deepEqual(sess.map((s) => [s.date, s.teachers]), [['2026-10-07', '測試甲、測試乙'], ['2026-10-14', '測試乙']]); // 10/14 沒人報名也有
  const ev = st.events.find((e) => e.dutyId === d1);
  assert.deepEqual(ev.absentNames, ['王小明']);
  assert.equal(ev.teachers, '測試甲、測試乙');
  void d2;
});
