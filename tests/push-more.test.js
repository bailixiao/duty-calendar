// 推播進階用途（apps-script/PushMore.gs）：借場地通知、後台推播（現在／排定）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0); // 台北 10/1 10:00
const ADMIN_EP = 'https://fcm.googleapis.com/fcm/send/admin-device-1';
const USER_EP = 'https://fcm.googleapis.com/fcm/send/user-device-22';

function setup() {
  const env = createEnv(OCT_1);
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const take = () => env.fn('takePendingPush_')();
  const idOf = (ep) => env.fn('pushIdOf_')(ep);
  const summary = (ep) => env.get({ action: 'pushSummary', id: idOf(ep) }).data;
  return { env, token, take, idOf, summary };
}

test('借場地：申請時通知開啟通知的管理者；審核後通知申請人的手機（拿過就沒有）', () => {
  const { env, token, take, summary } = setup();
  assert.equal(env.post({ action: 'adminVenueWatch', token, endpoint: ADMIN_EP, on: true }).data.on, true);
  assert.equal(env.post({ action: 'adminVenueWatch', token, endpoint: ADMIN_EP }).data.on, true);
  take();
  const req = env.post({ action: 'requestVenue', dates: ['2026-10-13'], slots: ['晚上'], name: '測試甲', phone: '0912345678', purpose: '讀書會' });
  assert.equal(req.ok, true, JSON.stringify(req.error));
  assert.deepEqual(take(), [ADMIN_EP]);
  const m = summary(ADMIN_EP).message;
  assert.equal(m.title, '🏠 有新的場地申請');
  assert.match(m.body, /測試甲.*10\/13.*晚上.*讀書會/);
  assert.equal(m.url, '#/admin/venue');
  assert.equal(summary(ADMIN_EP).message, undefined, '拿過就刪');

  assert.equal(env.post({ action: 'venueWatch', endpoint: USER_EP, id: req.data.id }).ok, true);
  assert.equal(env.post({ action: 'venueWatch', endpoint: USER_EP, id: 'V-nope' }).error.code, 'NOT_FOUND');
  const rows = env.post({ action: 'adminVenue', token }).data.requests;
  take();
  env.post({ action: 'adminVenueDecide', token, ids: [rows[0].id], decision: '不同意', note: '當天有活動' });
  assert.deepEqual(take(), [USER_EP]);
  const u = summary(USER_EP).message;
  assert.match(u.body, /10\/13.*晚上.*沒有借到.*當天有活動/);

  // 管理者關閉通知後就不送
  assert.equal(env.post({ action: 'adminVenueWatch', token, endpoint: ADMIN_EP, on: false }).data.on, false);
  env.post({ action: 'requestVenue', dates: ['2026-10-14'], slots: ['早上'], name: '測試乙', phone: '0912345679', purpose: '練唱' });
  assert.deepEqual(take(), []);
});

test('場管可以開啟場地通知，勤務帳號不行；唯讀、場管不能用後台推播', () => {
  const { env, token } = setup();
  const save = (a) => env.post({ action: 'adminSaveAccount', token, account: a });
  save({ account: '場地', role: '場管', password: 'abc12345' });
  save({ account: '勤務組', role: '勤務', password: 'abc12345' });
  save({ account: '看看', role: '唯讀', password: 'abc12345' });
  const login = (a) => env.post({ action: 'adminLogin', account: a, password: 'abc12345' }).data.token;
  const venue = login('場地');
  assert.equal(env.post({ action: 'adminVenueWatch', token: venue, endpoint: ADMIN_EP, on: true }).ok, true);
  assert.equal(env.post({ action: 'adminPushList', token: venue }).error.code, 'FORBIDDEN');
  const duty = login('勤務組');
  assert.equal(env.post({ action: 'adminVenueWatch', token: duty, endpoint: ADMIN_EP, on: true }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminPushList', token: duty }).ok, true);
  assert.equal(env.post({ action: 'adminPushList', token: login('看看') }).error.code, 'FORBIDDEN');
});

test('後台推播：現在推播送給所有開啟提醒的手機；排定的到時間才送；類別帳號只看自己類別', () => {
  const { env, token, take, summary } = setup();
  env.post({ action: 'pushSubscribe', endpoint: USER_EP });
  const list = env.post({ action: 'adminPushList', token }).data;
  assert.equal(list.devices, 1);
  const d = list.duties.find((x) => x.name === '彌勒山志工輪值');
  take();
  const now = env.post({ action: 'adminPushSave', token, plan: { dutyId: d.id, date: d.date, title: '📣 志工輪值', body: '還缺人喔', now: true } });
  assert.equal(now.ok, true, JSON.stringify(now.error));
  assert.deepEqual(take(), [USER_EP]);
  const msg = summary(USER_EP).message;
  assert.equal(msg.title, '📣 志工輪值');
  assert.equal(msg.url, '#/duty/' + encodeURIComponent(d.id) + '?date=' + d.date + '&go=signup');
  assert.equal(summary(USER_EP).message, undefined, '同一支手機只拿一次');
  assert.equal(now.data.plans[0].status, '已送出');
  assert.equal(now.data.plans[0].devices, '1');

  // 排定：時間要在現在之後；到時間才送
  assert.equal(env.post({ action: 'adminPushSave', token, plan: { title: 'x', body: 'y', at: '2026-10-01 09:00' } }).error.code, 'VALIDATION');
  const later = env.post({ action: 'adminPushSave', token, plan: { title: '📣 公告', body: '明天見', at: '2026-10-01T10:30' } });
  assert.equal(later.ok, true, JSON.stringify(later.error));
  const id = later.data.plans.find((p) => p.status === '排定').id;
  assert.equal(env.fn('runDuePushPlans_')().sent, 0);
  assert.deepEqual(take(), []);
  env.clock.now = Date.UTC(2026, 9, 1, 2, 31, 0); // 10:31
  assert.equal(env.fn('runDuePushPlans_')().sent, 1);
  assert.deepEqual(take(), [USER_EP]);
  const p = env.post({ action: 'adminPushList', token }).data.plans.find((x) => x.id === id);
  assert.equal(p.status, '已送出');
  assert.equal(env.post({ action: 'adminPushDelete', token, id }).error.code, 'VALIDATION', '送出的不能刪');

  // 類別帳號：不能推別的類別的活動，看不到別的類別的推播
  env.post({ action: 'adminSaveAccount', token, account: { account: '教育組', role: '教育', password: 'abc12345' } });
  const edu = env.post({ action: 'adminLogin', account: '教育組', password: 'abc12345' }).data.token;
  const eduList = env.post({ action: 'adminPushList', token: edu }).data;
  assert.ok(eduList.duties.every((x) => x.category === '教育'));
  assert.equal(eduList.plans.length, 0);
  assert.equal(env.post({ action: 'adminPushSave', token: edu, plan: { dutyId: d.id, date: d.date, title: 'x', body: 'y', now: true } }).error.code, 'FORBIDDEN');
});

test('排定的推播：活動刪除了就不送，標示原因', () => {
  const { env, token, take } = setup();
  const created = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '測試活動', category: '教育', nature: '課程', mode: '報名型', start: '2026-10-20', positions: [{ name: '參加', min: 0, max: null }] }] });
  assert.equal(created.ok, true, JSON.stringify(created.error));
  const d = env.post({ action: 'adminPushList', token }).data.duties.find((x) => x.name === '測試活動');
  env.post({ action: 'adminPushSave', token, plan: { dutyId: d.id, date: d.date, title: '📣 測試活動', body: '歡迎', at: '2026-10-01 11:00' } });
  env.post({ action: 'adminDeleteDuty', token, id: d.id });
  env.clock.now = Date.UTC(2026, 9, 1, 3, 5, 0);
  assert.equal(env.fn('runDuePushPlans_')().sent, 0);
  assert.deepEqual(take(), []);
  const p = env.post({ action: 'adminPushList', token }).data.plans[0];
  assert.deepEqual([p.status, p.note], ['沒有送出', '活動已經刪除']);
});

test('只提醒我報名的：填了名字的手機只列他報名的＋缺人數；沒報名也沒缺人就不送', () => {
  const OCT_12_EVENING = Date.UTC(2026, 9, 12, 12, 0, 0); // 台北 10/12 20:00，明天 10/13 有彌勒山志工輪值
  const env = createEnv(OCT_12_EVENING);
  env.fn('ensurePushKeys_')();
  const A = 'https://fcm.googleapis.com/fcm/send/me-device-1';
  const B = 'https://fcm.googleapis.com/fcm/send/all-device-2';
  env.post({ action: 'pushSubscribe', endpoint: A });
  env.post({ action: 'pushSubscribe', endpoint: B });
  assert.equal(env.post({ action: 'pushSetName', endpoint: A, name: '測 試甲' }).data.name, '測試甲');
  assert.equal(env.post({ action: 'pushSetName', endpoint: 'https://fcm.googleapis.com/fcm/send/none-0000', name: '測試甲' }).error.code, 'NOT_FOUND');
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  // 還沒報名、有缺人：兩支都送；填名字的那支 mine 是空的，shortItems 有
  assert.deepEqual(env.fn('dailyPushEndpoints_')('tomorrow').sort(), [A, B].sort());
  const idA = env.fn('pushIdOf_')(A);
  let s = env.get({ action: 'pushSummary', id: idA }).data;
  assert.deepEqual(s.mine, []);
  assert.ok(s.shortItems.length >= 1);
  env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親' }] });
  s = env.get({ action: 'pushSummary', id: idA }).data;
  assert.deepEqual(s.mine.map((m) => m.name), ['彌勒山志工輪值']);
  assert.equal(env.get({ action: 'pushSummary', id: env.fn('pushIdOf_')(B) }).data.mine, undefined, '沒填名字照舊');
  // 清掉名字
  assert.equal(env.post({ action: 'pushSetName', endpoint: A, name: '' }).data.name, '');
  assert.equal(env.get({ action: 'pushSummary', id: idA }).data.mine, undefined);
});

test('缺人自動推播：時間到、有缺人才送，一天一次；只有總管理者、勤務帳號能設定', () => {
  const OCT_10_1830 = Date.UTC(2026, 9, 10, 10, 30, 0); // 台北 10/10 18:30；10/13 彌勒山志工輪值缺人
  const { env, token, take, summary } = (() => { const e = createEnv(OCT_10_1830); e.fn('ensurePushKeys_')(); const t = e.post({ action: 'adminLogin', password: 'test-pass' }).data.token; return { env: e, token: t, take: () => e.fn('takePendingPush_')(), summary: (ep) => e.get({ action: 'pushSummary', id: e.fn('pushIdOf_')(ep) }).data }; })();
  env.post({ action: 'pushSubscribe', endpoint: USER_EP });
  env.post({ action: 'adminSaveAccount', token, account: { account: '教育組', role: '教育', password: 'abc12345' } });
  const edu = env.post({ action: 'adminLogin', account: '教育組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminAutoPushSave', token: edu, auto: { on: true, days: [3], time: '19:00' } }).error.code, 'FORBIDDEN');
  const saved = env.post({ action: 'adminAutoPushSave', token, auto: { on: true, days: [3, 1], time: '19:00' } });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  assert.deepEqual([saved.data.auto.on, saved.data.auto.days, saved.data.auto.time], [true, [3, 1], '19:00']);
  take();
  env.fn('runDuePushPlans_')();
  assert.deepEqual(take(), [], '還沒到 19:00');
  env.clock.now = Date.UTC(2026, 9, 10, 11, 2, 0); // 19:02
  env.fn('runDuePushPlans_')();
  assert.deepEqual(take(), [USER_EP]);
  const m = summary(USER_EP).message;
  assert.equal(m.title, '🙋 還缺人，歡迎發心');
  assert.match(m.body, /10\/13.*彌勒山志工輪值.*缺/);
  env.fn('runDuePushPlans_')();
  assert.deepEqual(take(), [], '一天只送一次');
  const plan = env.post({ action: 'adminPushList', token }).data.plans.find((p) => p.by === '自動');
  assert.equal(plan.received, 1, '收到數');
  env.get({ action: 'pushClick', id: plan.id, dev: 'abc' });
  env.get({ action: 'pushClick', id: plan.id, dev: 'abc' });
  assert.equal(env.post({ action: 'adminPushList', token }).data.plans.find((p) => p.id === plan.id).clicks, 1, '同一支手機只算一次點開');
});

test('同步停了：超過 45 分鐘通知開啟系統通知的總管理者手機，恢復後再通知', () => {
  const env = createEnv(OCT_1);
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  assert.equal(env.post({ action: 'adminSystemWatch', token, endpoint: ADMIN_EP, on: true }).data.on, true);
  const take = () => env.fn('takePendingPush_')();
  const props = env.fn('PropertiesService').getScriptProperties();
  take();
  assert.deepEqual(env.fn('checkSyncHealth_')(), { skipped: 'never-synced' });
  props.setProperty('LAST_SYNC_AT', '2026-10-01 09:00:00');
  env.fn('checkSyncHealth_')();
  assert.deepEqual(take(), [ADMIN_EP]);
  env.fn('checkSyncHealth_')();
  assert.deepEqual(take(), [], '不重複通知');
  props.setProperty('LAST_SYNC_AT', '2026-10-01 09:58:00');
  assert.deepEqual(env.fn('checkSyncHealth_')(), { recovered: true });
  assert.deepEqual(take(), [ADMIN_EP]);
});

test('組長的前一天提醒：是明天勤務的組長，提醒附職稱、報名人數、點名碼', () => {
  const OCT_12_EVENING = Date.UTC(2026, 9, 12, 12, 0, 0);
  const env = createEnv(OCT_12_EVENING);
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const A = 'https://fcm.googleapis.com/fcm/send/leader-device-1';
  env.post({ action: 'pushSubscribe', endpoint: A });
  env.post({ action: 'pushSetName', endpoint: A, name: '測試甲' });
  const id = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '測試長青班勤務', start: '2026-10-13', leaderTitle: '勤務組長', positions: [{ name: '淨手', max: '5' }] }] }).data.ids[0];
  const d = env.get({ action: 'getDuty', id }).data;
  env.post({ action: 'signup', dutyId: id, positionId: d.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親', leader: true }, { name: '測試乙', identity: '道親' }] });
  assert.equal(env.fn('ensureLeaderCodes_')('tomorrow'), 1);
  const s = env.get({ action: 'pushSummary', id: env.fn('pushIdOf_')(A) }).data;
  const lead = s.mine.find((m) => m.leader);
  assert.equal(lead.leader, '勤務組長');
  assert.equal(lead.people, 2);
  assert.match(lead.code, /^\d{4}$/);
});
