// 區中心場地借用（apps-script/Venue.gs）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('場地借用：申請（待審核）→ 同意後行事曆看得到姓名用途、看不到電話；同一時段不能再同意', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  // 資料錯誤
  assert.equal(env.post({ action: 'requestVenue', date: '2026-10-01', slots: ['下午'], name: '測試甲', phone: '0912345678', purpose: '讀書會' }).error.code, 'VALIDATION'); // 今天不行
  assert.equal(env.post({ action: 'requestVenue', date: '2026-10-20', slots: [], name: '測試甲', phone: '0912345678', purpose: '讀書會' }).error.code, 'VALIDATION');
  assert.equal(env.post({ action: 'requestVenue', date: '2026-10-20', slots: ['下午'], name: '測試甲', phone: '12', purpose: '讀書會' }).error.code, 'VALIDATION');
  // 兩個人申請同一時段
  const a = env.post({ action: 'requestVenue', date: '2026-10-20', slots: ['下午', '晚上'], name: '測試甲', phone: '0912345678', purpose: '讀書會', people: '12' });
  assert.equal(a.ok, true, JSON.stringify(a.error));
  const b = env.post({ action: 'requestVenue', date: '2026-10-20', slots: ['下午'], name: '測試乙', phone: '0987654321', purpose: '練唱' });
  assert.equal(b.ok, true);
  let v = env.get({ action: 'getVenue', from: '2026-10-20', to: '2026-10-20' }).data.days['2026-10-20'];
  assert.deepEqual(v.map((x) => x.status), ['可以借', '審核中', '審核中']);
  assert.equal(JSON.stringify(v).indexOf('0912345678'), -1, '公開資料沒有電話');
  // 後台看得到電話；同意測試甲的兩個時段
  const list = call('adminVenue', {}).data.requests;
  assert.equal(list.find((r) => r.name === '測試甲').phone, '0912345678');
  const ids = list.filter((r) => r.name === '測試甲').map((r) => r.id);
  assert.equal(call('adminVenueDecide', { ids, decision: '已同意' }).ok, true);
  // 測試乙同一時段不能再同意，可以不同意
  const bid = list.find((r) => r.name === '測試乙').id;
  assert.equal(call('adminVenueDecide', { ids: [bid], decision: '已同意' }).error.code, 'VALIDATION');
  assert.equal(call('adminVenueDecide', { ids: [bid], decision: '不同意', note: '時段已借出' }).ok, true);
  v = env.get({ action: 'getVenue', from: '2026-10-20', to: '2026-10-20' }).data.days['2026-10-20'];
  assert.deepEqual(v.map((x) => [x.status, x.name]), [['可以借', ''], ['已借出', '測試甲'], ['已借出', '測試甲']]);
  // 已借出的時段不能再申請
  assert.equal(env.post({ action: 'requestVenue', date: '2026-10-20', slots: ['晚上'], name: '測試丙', phone: '0911111111', purpose: '開會' }).error.code, 'VALIDATION');
  // 行事曆資料帶已借出（沒有電話）
  const ev = env.get({ action: 'getEvents', from: '2026-10-20', to: '2026-10-20' }).data;
  assert.deepEqual(ev.venue, [{ date: '2026-10-20', slot: '下午', name: '測試甲', purpose: '讀書會' }, { date: '2026-10-20', slot: '晚上', name: '測試甲', purpose: '讀書會' }]);
  // 查自己的申請
  const mine = env.post({ action: 'myVenue', name: '測試乙' }).data.requests;
  assert.deepEqual(mine.map((r) => [r.status, r.note]), [['不同意', '時段已借出']]);
});

test('場地借用：區中心當天有活動會標出來；審核只有總管理者與場管帳號；場管看不到其他資料', () => {
  const env = createEnv(OCT_1);
  const superTok = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token: superTok }, body));
  call('adminCreateDuties', { duties: [{ name: '讀書會', category: '教育', nature: '課程', start: '2026-10-21', startTime: '15:30', endTime: '17:00', location: '教全區中心', positions: [{ name: '參加', min: '0' }] }] });
  const v = env.get({ action: 'getVenue', from: '2026-10-21', to: '2026-10-21' }).data.days['2026-10-21'];
  assert.deepEqual(v.map((x) => x.activities), [[], ['讀書會'], []]);
  const save = (account, role) => call('adminSaveAccount', { account: { account, role, password: 'abc12345' } });
  save('道務組', '道務');
  const dao = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  env.post({ action: 'requestVenue', date: '2026-10-22', slots: ['早上'], name: '測試甲', phone: '0912345678', purpose: '開會' });
  const id = call('adminVenue', {}).data.requests[0].id;
  assert.equal(env.post({ action: 'adminVenue', token: dao }).ok, true, '道務看得到');
  assert.equal(env.post({ action: 'adminVenueDecide', token: dao, ids: [id], decision: '已同意' }).error.code, 'FORBIDDEN');
  save('場管', '場管');
  const mgr = env.post({ action: 'adminLogin', account: '場管', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminMembers', token: mgr }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminVenueDecide', token: mgr, ids: [id], decision: '已同意' }).ok, true);
  assert.equal(env.post({ action: 'adminMe', token: mgr }).data.role, '場管');
});

test('場地借用：一次申請好幾天（同樣時段、同一個申請）；其中一天已借出就整筆不送', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const r = env.post({ action: 'requestVenue', dates: ['2026-10-27', '2026-10-13', '2026-10-20'], slots: ['晚上'], name: '測試甲', phone: '0912345678', purpose: '讀書會' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.dates, ['2026-10-13', '2026-10-20', '2026-10-27']);
  const list = env.post({ action: 'adminVenue', token }).data.requests;
  assert.equal(new Set(list.map((x) => x.group)).size, 1);
  assert.equal(list.length, 3);
  env.post({ action: 'adminVenueDecide', token, ids: [list[1].id], decision: '已同意' }); // 10/20 晚上借出
  const r2 = env.post({ action: 'requestVenue', dates: ['2026-10-20', '2026-10-21'], slots: ['晚上'], name: '測試乙', phone: '0987654321', purpose: '練唱' });
  assert.equal(r2.error.code, 'VALIDATION');
  assert.match(r2.error.details[0].message, /10\/20/);
});

test('場地借用：申請人只能申請取消（要對得上電話），管理者同意取消才算', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  env.post({ action: 'requestVenue', dates: ['2026-10-13', '2026-10-20'], slots: ['晚上'], name: '測試甲', phone: '0912-345-678', purpose: '讀書會' });
  const mine = env.post({ action: 'myVenue', name: '測試甲' }).data.requests;
  assert.deepEqual(mine.map((r) => r.canCancel), [true, true]);
  env.post({ action: 'adminVenueDecide', token, ids: [mine[0].id, mine[1].id], decision: '已同意' });
  assert.equal(env.post({ action: 'cancelVenue', ids: [mine[0].id], name: '測試甲', phone: '0999999999' }).error.code, 'FORBIDDEN');
  const r = env.post({ action: 'cancelVenue', ids: [mine[0].id, mine[1].id], name: '測試甲', phone: '0912345678' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.requests.map((x) => [x.status, x.canCancel, x.cancelPending]), [['已同意', false, true], ['已同意', false, true]], '狀態不變，等審核');
  assert.equal(env.get({ action: 'getEvents', from: '2026-10-20', to: '2026-10-20' }).data.venue.length, 1, '還沒同意取消，行事曆照樣顯示');
  assert.equal(env.post({ action: 'cancelVenue', ids: [mine[0].id], name: '測試甲', phone: '0912345678' }).error.code, 'VALIDATION', '不能重複申請');
  const adm = env.post({ action: 'adminVenue', token }).data.requests;
  assert.deepEqual(adm.map((x) => !!x.cancelAsk), [true, true]);
  env.post({ action: 'adminVenueDecide', token, ids: [mine[1].id], decision: '同意取消' });
  env.post({ action: 'adminVenueDecide', token, ids: [mine[0].id], decision: '不同意取消', note: '當天有活動要用' });
  const after = env.post({ action: 'myVenue', name: '測試甲' }).data.requests;
  assert.deepEqual(after.map((x) => [x.status, x.cancelPending, x.note]), [['已同意', false, '不同意取消：當天有活動要用'], ['已取消', false, '申請人申請取消，已同意']]);
  assert.deepEqual(env.get({ action: 'getEvents', from: '2026-10-20', to: '2026-10-20' }).data.venue, [], '同意取消後行事曆就沒有了');
});

test('修繕回報：公開列表不含回報人電話；通知管理者；處理中、已修好通知回報人；只有總管理者、場管能處理', () => {
  const env = createEnv(OCT_1);
  env.fn('ensurePushKeys_')();
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ADMIN = 'https://fcm.googleapis.com/fcm/send/admin-1';
  const USER = 'https://fcm.googleapis.com/fcm/send/user-22';
  env.post({ action: 'adminVenueWatch', token, endpoint: ADMIN, on: true });
  const take = () => env.fn('takePendingPush_')();
  take();
  assert.equal(env.post({ action: 'reportRepair', location: '不存在', problem: 'x', name: '測試甲', phone: '0912345678' }).error.code, 'VALIDATION');
  const r = env.post({ action: 'reportRepair', location: '冷氣', detail: '教室', problem: '冷氣不冷，會滴水', urgency: '有危險', name: '測試甲', phone: '0912-345-678', photos: ['F-abcdef123456', 'bad'] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(take(), [ADMIN], '通知管理者');
  const pub = env.get({ action: 'getRepairs' }).data.items;
  assert.equal(pub.length, 1);
  assert.equal(JSON.stringify(pub).indexOf('0912'), -1, '公開的不含電話');
  assert.equal(JSON.stringify(pub).indexOf('測試甲'), -1, '公開的不含回報人');
  assert.equal(env.post({ action: 'repairWatch', endpoint: USER, id: r.data.id }).ok, true);
  const adm = env.post({ action: 'adminRepairs', token }).data.items[0];
  assert.deepEqual([adm.phone, adm.photos], ['0912-345-678', ['F-abcdef123456']]);
  env.post({ action: 'adminSaveAccount', token, account: { account: '勤務組', role: '勤務', password: 'abc12345' } });
  const duty = env.post({ action: 'adminLogin', account: '勤務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminRepairUpdate', token: duty, id: adm.id, status: '處理中' }).error.code, 'FORBIDDEN');
  take();
  const u = env.post({ action: 'adminRepairUpdate', token, id: adm.id, status: '處理中', note: '已請師傅', vendor: '測試水電', cost: '1,500' });
  assert.equal(u.ok, true, JSON.stringify(u.error));
  assert.deepEqual(take(), [USER], '通知回報人');
  env.post({ action: 'adminRepairUpdate', token, id: adm.id, status: '已修好', note: '已修好', vendor: '測試水電', cost: '1500' });
  const after = env.post({ action: 'adminRepairs', token }).data;
  assert.deepEqual([after.items[0].status, after.costTotal], ['已修好', 1500]);
  assert.equal(env.get({ action: 'getRepairs' }).data.items[0].status, '已修好', '7 天內修好的還會顯示');
});
