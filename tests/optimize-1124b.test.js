// 2026/11/24 優化（二）：出席確認（Attendance.gs）、關心名單認領（EduCare.gs）、可能重複的成員（MemberDups）、個人感謝卡（YearReport.person）。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');
const MemberDups = require('../js/member-dups.js');
const YearReport = require('../js/year-report.js');

test('出席確認：過了的場次列出來；改出席、按確認就拿掉；隔天早上推給收系統通知的手機', () => {
  const env = createEnv(Date.UTC(2026, 11, 18, 2, 0, 0)); // 12/18
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const mk = (name, mode) => ({ name, category: '勤務', nature: '活動', mode: mode || '報名型', start: '2026-12-19', end: '2026-12-19', location: '測試地點', positions: [{ name: '參加' }] });
  const made = call('adminCreateDuties', { duties: [mk('測試甲活動'), mk('測試乙活動')] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const ev = env.get({ action: 'getEvents', from: '2026-12-19', to: '2026-12-19' }).data.duties;
  const a = ev.find((d) => d.name === '測試甲活動'), b = ev.find((d) => d.name === '測試乙活動');
  const sa = env.post({ action: 'signup', dutyId: a.id, positionId: a.positions[0].id, dates: ['2026-12-19'], entries: [{ name: '測試甲' }] });
  env.post({ action: 'signup', dutyId: b.id, positionId: b.positions[0].id, dates: ['2026-12-19'], entries: [{ name: '測試乙' }] });
  assert.equal(call('adminAttendPending', {}).data.items.length, 0, '還沒到的不列');

  env.clock.now = Date.UTC(2026, 11, 20, 2, 0, 0); // 12/20
  let p = call('adminAttendPending', {}).data;
  assert.deepEqual(p.items.map((x) => [x.name, x.count]).sort(), [['測試乙活動', 1], ['測試甲活動', 1]]);
  // 改未到＝看過名單，自動算確認
  const sid = (sa.data.signupIds || sa.data.ids || [])[0] || call('adminDuty', { id: a.id }).data.signups[0].id;
  assert.equal(call('adminSetAttendance', { signupId: sid, attend: '未到' }).ok, true);
  p = call('adminAttendPending', {}).data;
  assert.deepEqual(p.items.map((x) => x.name), ['測試乙活動']);
  assert.ok(call('adminDuty', { id: a.id }).data.attendOk['2026-12-19'], '勤務名單頁看得到已確認');

  // 隔天早上：推給收系統通知的手機（一天一次）
  const E = 'https://fcm.googleapis.com/fcm/send/attend-admin';
  env.post({ action: 'pushSubscribe', endpoint: E });
  env.fn('addPushTarget_')(E, '系統通知', '');
  const r = env.fn('attendRemind_')();
  assert.deepEqual([r.items, r.phones], [1, 1]);
  const msgs = env.fn('readTable_')(env.fn('SHEETS').PUSH_INBOX);
  assert.match(msgs[msgs.length - 1]['標題'], /昨天 1 場還沒確認出席/);
  assert.equal(env.fn('attendRemind_')().skipped, 'done');

  // 按「✓ 沒問題」；取消確認又回來
  assert.equal(call('adminAttendOk', { items: [{ dutyId: b.id, date: '2026-12-19' }] }).ok, true);
  assert.equal(call('adminAttendPending', {}).data.items.length, 0);
  call('adminAttendOk', { items: [{ dutyId: b.id, date: '2026-12-19' }], undo: true });
  assert.equal(call('adminAttendPending', {}).data.items.length, 1);
  // 還沒到的日期不能確認
  assert.equal(call('adminAttendOk', { items: [{ dutyId: b.id, date: '2026-12-25' }] }).ok, false);
});

test('關心名單認領：寫誰負責、取消；要填名字', () => {
  const env = createEnv(Date.UTC(2026, 10, 24, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(call('adminEduCareClaim', { key: '測試甲|away|2026-09-01', name: '測試甲' }).ok, false, '沒寫誰負責');
  const r = call('adminEduCareClaim', { key: '測試甲|away|2026-09-01', name: '測試甲', who: '測試乙' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.claims['測試甲|away|2026-09-01'].who, '測試乙');
  assert.equal(call('adminEduCareList', {}).data.claims['測試甲|away|2026-09-01'].who, '測試乙');
  const u = call('adminEduCareClaim', { key: '測試甲|away|2026-09-01', name: '測試甲', undo: true });
  assert.equal(u.data.claims['測試甲|away|2026-09-01'], undefined);
});

test('可能重複的成員：空白、異體字、沒寫姓、差一個字；不同佛堂的同名不列；記過「不是同一人」的不列', () => {
  const m = (row, name, temple) => ({ row, name, temple: temple || '', active: true });
  const list = [m(1, '測試甲乙'), m(2, '測試 甲乙'), m(3, '王台明', 'A'), m(4, '王臺明', 'A'), m(5, '小華'), m(6, '陳小華'),
    m(7, '林一二', 'A'), m(8, '林一三', 'A'), m(9, '張同名', 'A'), m(10, '張同名', 'B'), m(11, '李別人', 'A'), m(12, '李別人', 'B')];
  const pairs = MemberDups.find(list);
  const got = pairs.map((p) => [p.a.row, p.b.row, p.why]);
  assert.deepEqual(got.map((x) => x.slice(0, 2)), [[1, 2], [3, 4], [5, 6], [7, 8]]);
  assert.match(got[3][2], /只差一個字/);
  assert.equal(MemberDups.whyLike(m(1, '張同名', 'A'), m(2, '張同名', 'B')), '', '同名不同佛堂是不同人');
  assert.equal(MemberDups.whyLike(m(1, '王小明'), m(2, '李小明')), '', '姓不同不算');
  const ignore = new Set([pairs[0].key]);
  assert.equal(MemberDups.find(list, ignore).length, 3);
  assert.equal(MemberDups.find([Object.assign(m(1, '測試甲'), { pending: true }), m(2, '測試 甲')]).length, 0, '待確認的有自己的合併');
});

test('個人感謝卡：這一年的次數、天數、類別、最常參加、和去年同一天比', () => {
  const ev = (date, name, category, dao, tan) => ({ date, name, series: name, category, dao: dao || [], tan: tan || [], unknown: [], accompany: [] });
  const events = [
    ev('2025-03-01', '測試法會', '道務', ['測試甲']),
    ev('2025-12-01', '測試法會', '道務', ['測試甲']), // 去年 11/24 以後：不算
    ev('2026-03-01', '測試法會', '道務', ['測試甲']),
    ev('2026-03-01', '測試輪值', '勤務', [], ['測試甲']),
    ev('2026-05-01', '測試輪值', '勤務', [], ['測試甲']),
    ev('2026-11-20', '測試讀經班', '教育', ['測試乙'])
  ];
  const p = YearReport.person(events, '測試甲', 2026, '2026-11-24');
  assert.deepEqual([p.count, p.days, p.last, p.roc], [3, 2, 1, 115]);
  assert.deepEqual(p.cats, [{ name: '總務・勤務', count: 2 }, { name: '道務', count: 1 }]);
  assert.deepEqual(p.top[0], { name: '測試輪值', count: 2 });
  assert.equal(p.first.date, '2026-03-01');
  assert.equal(p.latest.name, '測試輪值');
  const L = YearReport.cardLines(p);
  assert.equal(L.head, '115 年，您參加了 3 次、共 2 天');
  assert.equal(L.vs, '比去年多了 2 次 🎉');
  assert.match(L.latest, /5\/1 測試輪值/);
  assert.equal(YearReport.person(events, '測試丙', 2026, '2026-11-24').count, 0);
});
