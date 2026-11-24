// 2026/11/24 優化：活動隔天提醒上傳照片（Album.gs albumRemind_）、人力負荷（StatsCalc.busyList）、年度報表（YearReport.build）。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');
const C = require('../js/stats-calc.js');
const YearReport = require('../js/year-report.js');

test('活動隔天提醒上傳照片：勾了的活動，隔天只推給有來、手機填了名字的人；一天只送一次', () => {
  const env = createEnv(Date.UTC(2026, 11, 18, 2, 0, 0)); // 12/18
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const mk = (name, photoRemind) => ({ name, category: '勤務', nature: '活動', mode: '報名型', start: '2026-12-19', end: '2026-12-20', location: '測試地點', photoRemind, positions: [{ name: '參加' }] });
  const made = call('adminCreateDuties', { duties: [mk('測試出遊', true), mk('測試輪值', false)] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const duty = call('adminDutyForEdit', { id: made.data.ids[0] }).data;
  assert.ok([true, '是'].includes((duty.duty || duty).photoRemind), '存起來了');
  const ev = env.get({ action: 'getEvents', from: '2026-12-19', to: '2026-12-19' }).data.duties;
  const trip = ev.find((d) => d.name === '測試出遊'), other = ev.find((d) => d.name === '測試輪值');
  env.post({ action: 'signup', dutyId: trip.id, positionId: trip.positions[0].id, dates: ['2026-12-19'], entries: [{ name: '測試甲' }] });
  env.post({ action: 'signup', dutyId: other.id, positionId: other.positions[0].id, dates: ['2026-12-19'], entries: [{ name: '測試乙' }] });
  const A = 'https://fcm.googleapis.com/fcm/send/photo-a', B = 'https://fcm.googleapis.com/fcm/send/photo-b', N = 'https://fcm.googleapis.com/fcm/send/photo-none';
  [A, B, N].forEach((e) => env.post({ action: 'pushSubscribe', endpoint: e }));
  env.post({ action: 'pushSetName', endpoint: A, name: '測試甲' });
  env.post({ action: 'pushSetName', endpoint: B, name: '測試乙' });
  env.clock.now = Date.UTC(2026, 11, 20, 23, 0, 0); // 台北 12/21 早上 7 點（最後一天 12/20 的隔天）
  const r = env.fn('albumRemind_')();
  assert.deepEqual([r.duties, r.phones], [1, 1], '只有勾了的活動、只送給有來的測試甲');
  const msgs = env.fn('readTable_')(env.fn('SHEETS').PUSH_INBOX);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]['裝置ID'], env.fn('pushIdOf_')(A));
  assert.match(msgs[0]['標題'], /測試出遊/);
  assert.match(msgs[0]['網址'], /#\/duty\/.+\?date=2026-12-20/);
  assert.equal(env.fn('albumRemind_')().skipped, 'done', '同一天不重送');
});

test('人力負荷：最近 30 天出勤 N 次以上的人，附做了哪些；平均次數', () => {
  const ev = (date, name, dao, tan) => ({ date, name, series: name, dao: dao || [], tan: tan || [], unknown: [], accompany: [] });
  const events = [];
  for (let i = 1; i <= 9; i++) events.push(ev(`2026-11-${String(i).padStart(2, '0')}`, i % 3 ? '測試輪值' : '測試打掃', ['測試甲'], i < 3 ? ['測試乙'] : []));
  events.push(ev('2026-09-01', '測試輪值', ['測試甲'])); // 30 天以前的不算
  const r = C.busyList(events, '2026-11-24', 30, 8);
  assert.deepEqual(r.people.map((x) => [x.name, x.count, x.days]), [['測試甲', 9, 9]]);
  assert.deepEqual(r.people[0].items, [{ name: '測試輪值', count: 6 }, { name: '測試打掃', count: 3 }]);
  assert.equal(r.total, 2);
  assert.equal(r.avg, 5.5);
  assert.equal(C.busyList(events, '2026-11-24', 30, 10).people.length, 0);
});

test('年度報表：總覽、和去年同一天比、各類別、每個月、人次最多的活動、感謝名單', () => {
  const ev = (date, name, category, dao, tan) => ({ date, name, series: name, category, dao, tan: tan || [], unknown: [], accompany: [] });
  const events = [
    ev('2025-03-01', '測試法會', '道務', ['測試甲']),
    ev('2025-12-01', '測試法會', '道務', ['測試甲', '測試乙']), // 去年 11/24 以後：今年還沒過完，不算
    ev('2026-03-01', '測試法會', '道務', ['測試甲', '測試乙'], ['測試丙']),
    ev('2026-05-01', '測試輪值', '勤務', ['測試甲']),
    ev('2026-11-20', '測試讀經班', '教育', [], ['測試丙'])
  ];
  const r = YearReport.build(events, 2026, '2026-11-24', C);
  assert.equal(r.roc, 115);
  assert.equal(r.until, '2026-11-24');
  assert.deepEqual([r.total.events, r.total.total, r.total.people], [3, 5, 3]);
  assert.deepEqual([r.last.events, r.last.total], [1, 1], '去年只算到 11/24');
  assert.deepEqual(r.cats.map((c) => [c.name, c.total]), [['勤務', 1], ['道務', 3], ['教育', 1]]);
  assert.equal(r.months[2].total, 3);
  assert.equal(r.months[11].future, true);
  assert.equal(r.top[0].name, '測試法會');
  assert.deepEqual(r.thanks.map((x) => [x.name, x.count]).sort(), [['測試丙', 2], ['測試乙', 1], ['測試甲', 2]]);
  assert.equal(r.thanks[2].name, '測試乙', '次數多的在前');
  assert.equal(YearReport.diff(5, 1), '比去年多 400%');
  assert.equal(YearReport.diff(5, 0), '');
  const text = YearReport.text(r, '測試區');
  assert.match(text, /測試區 115 年度報表/);
  assert.match(text, /出勤 5 人次（去年 1/);
  // 去年整年
  const r25 = YearReport.build(events, 2025, '2026-11-24', C);
  assert.equal(r25.until, '');
  assert.equal(r25.total.total, 3);
});
