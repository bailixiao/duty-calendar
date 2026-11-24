// 2026/11/24 優化（三）：要處理的事（adminTodo）、「不是同一人」共用（adminDupIgnore）、生日祝福推播（birthdayPush_）、新朋友回訪（StatsCalc.newcomerList）。
// 測試用的名字一律用假名，本儲存庫不放真實人名；電話是假的。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');
const C = require('../js/stats-calc.js');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('要處理的事：新成員待確認、場地申請待審、修繕待處理', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const t0 = call('adminTodo', {}).data;
  assert.deepEqual([t0.venue, t0.venueAsk, t0.repairs], [0, 0, 0]);
  const req = env.post({ action: 'requestVenue', dates: ['2026-10-13'], slots: ['18:00', '19:00'], name: '測試甲', phone: '0912345678', purpose: '讀書會' });
  assert.equal(req.ok, true, JSON.stringify(req.error));
  const rep = env.post({ action: 'reportRepair', problem: '燈不亮', name: '測試乙', phone: '0912345678' });
  assert.equal(rep.ok, true, JSON.stringify(rep.error));
  env.fn('appendRows_')(env.fn('SHEETS').MEMBERS, [{ '姓名': '測試新朋友', '待確認': '是', '啟用中': '是' }]);
  env.fn('invalidateTable_')(env.fn('SHEETS').MEMBERS);
  const t = call('adminTodo', {}).data;
  assert.equal(t.venue, 1);
  assert.equal(t.repairs, 1);
  assert.equal(t.members, t0.members + 1);
});

test('「不是同一人」記在網站上，成員名單一起回傳；取消', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  assert.equal(call('adminDupIgnore', { keys: [] }).ok, false);
  const r = call('adminDupIgnore', { keys: ['測試甲|＋測試乙|'] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(call('adminMembers', {}).data.dupIgnore, ['測試甲|＋測試乙|']);
  call('adminDupIgnore', { keys: ['測試甲|＋測試乙|'] }); // 重複記不會變兩筆
  assert.equal(call('adminMembers', {}).data.dupIgnore.length, 1);
  call('adminDupIgnore', { keys: ['測試甲|＋測試乙|'], undo: true });
  assert.deepEqual(call('adminMembers', {}).data.dupIgnore, []);
});

test('生日祝福推播：關著不送；打開後今天生日、手機填了名字的才送，一天一次', () => {
  const env = createEnv(Date.UTC(2026, 11, 20, 23, 0, 0)); // 台北 12/21 早上 7 點
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  for (const [name, birth] of [['測試壽星', '1990-12-21'], ['測試平日', '1990-05-01']]) {
    const r = call('adminSaveMember', { member: { name, identity: '道親', birth, groups: {}, active: true } });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  }
  const A = 'https://fcm.googleapis.com/fcm/send/bday-a', B = 'https://fcm.googleapis.com/fcm/send/bday-b';
  [A, B].forEach((e) => env.post({ action: 'pushSubscribe', endpoint: e }));
  env.post({ action: 'pushSetName', endpoint: A, name: '測試壽星' });
  env.post({ action: 'pushSetName', endpoint: B, name: '測試平日' });
  assert.equal(env.fn('birthdayPush_')().skipped, 'off');
  const s = call('adminBdayPushSave', { on: true });
  assert.equal(s.ok, true, JSON.stringify(s.error));
  assert.equal(s.data.bday, true);
  const r = env.fn('birthdayPush_')();
  assert.deepEqual([r.people, r.phones], [1, 1]);
  const msgs = env.fn('readTable_')(env.fn('SHEETS').PUSH_INBOX);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]['裝置ID'], env.fn('pushIdOf_')(A));
  assert.match(msgs[0]['標題'], /測試壽星，生日快樂/);
  assert.equal(env.fn('birthdayPush_')().skipped, 'done');
});

test('新朋友回訪：第一次來 30～90 天前、之後沒再來的人', () => {
  const ev = (date, dao) => ({ date, name: '測試活動', series: '測試活動', dao, tan: [], unknown: [], accompany: [] });
  const events = [
    ev('2026-09-10', ['測試新甲']), // 75 天前，只來一次 → 列
    ev('2026-11-10', ['測試新乙']), // 14 天前 → 還不到一個月，不列
    ev('2026-06-01', ['測試新丙']), // 太久以前，不列
    ev('2026-09-01', ['測試回來']), ev('2026-10-01', ['測試回來']) // 有再來，不列
  ];
  const r = C.newcomerList(events, '2026-11-24');
  assert.deepEqual(r.map((x) => [x.name, x.last, x.isNew, x.daysAgo]), [['測試新甲', '2026-09-10', true, 75]]);
});
