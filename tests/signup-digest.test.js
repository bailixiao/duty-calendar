// 管理者知道誰報名（apps-script/SignupDigest.gs）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('最新報名：最近 3 天的報名、取消、改期；類別帳號只看自己類別；唯讀不能看', () => {
  const env = createEnv(OCT_1);
  const tok = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body, t) => env.post(Object.assign({ action, token: t || tok }, body));
  const v = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '壇辦', accompany: true }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  env.post({ action: 'cancel', signupId: r.data.created[0].id });
  const list = call('adminRecentSignups').data;
  assert.equal(list.today, '2026-10-01');
  assert.deepEqual(list.items.map((x) => [x.action, x.name]), [['取消', '測試甲'], ['報名', '測試乙'], ['報名', '測試甲']]);
  assert.equal(list.items[1].accompany, true);
  assert.equal(list.items[0].dutyName, '彌勒山志工輪值');
  assert.ok(!JSON.stringify(list).includes('0900'));

  call('adminSaveAccount', { account: { account: '道務組', role: '道務', password: 'abc12345' } });
  call('adminSaveAccount', { account: { account: '看看', role: '唯讀', password: 'abc12345' } });
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  assert.deepEqual(call('adminRecentSignups', {}, dw).data.items, [], '道務帳號看不到勤務的報名');
  const ro = env.post({ action: 'adminLogin', account: '看看', password: 'abc12345' }).data.token;
  assert.equal(call('adminRecentSignups', {}, ro).error.code, 'FORBIDDEN');

  // 三天前的不列
  env.clock.now = Date.UTC(2026, 9, 4, 2);
  assert.deepEqual(call('adminRecentSignups').data.items, []);
});

test('每天晚上的報名彙整：開了的手機才收、今天沒異動不送', () => {
  const env = createEnv(OCT_1);
  const tok = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ep = 'https://fcm.googleapis.com/fcm/send/test-digest';
  env.post({ action: 'pushSubscribe', endpoint: ep });
  assert.equal(env.post({ action: 'adminSignupDigestWatch', token: tok, endpoint: ep, on: true }).data.on, true);
  assert.deepEqual(env.fn('sendSignupDigest_')(), { sent: 0 }, '今天沒有人報名就不送');
  const v = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  env.post({ action: 'signup', dutyId: v.id, positionId: v.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(env.fn('sendSignupDigest_')().sent, 1);
  assert.match(env.fn('signupDigestText_')(env.fn('signupActivity_')('2026-10-01')), /今天 1 筆報名\n＋測試甲 10\/13/);
  assert.equal(env.post({ action: 'adminSignupDigestWatch', token: tok, endpoint: ep, on: false }).data.on, false);
});
