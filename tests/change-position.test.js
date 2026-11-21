// 換了愿項目（2026/11/21）：同一個勤務、同一天只換項目；佛堂、註記保留；名額照規則；可以還原。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup(extra) {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const made = call('adminCreateDuties', { duties: [Object.assign({ name: '測試活動', category: '勤務', nature: '活動', start: '2026-11-20', end: '2026-11-20',
    positions: [{ name: '甲項', max: 5 }, { name: '乙項', max: 1 }, { name: '丙項' }] }, extra)] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const duty = env.get({ action: 'getDuty', id: made.data.ids[0] }).data;
  const pid = (n) => duty.positions.find((p) => p.name === n).id;
  const signup = (name, pos) => {
    const r = env.post({ action: 'signup', dutyId: duty.id, positionId: pid(pos), dates: ['2026-11-20'], entries: [{ name, identity: '道親' }] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.data.created[0].id;
  };
  return { env, call, duty, pid, signup };
}

test('換項目：活動也可以；直接改原本那筆；查我的報名有 multiPos', () => {
  const { env, duty, pid, signup } = setup();
  const sid = signup('測試甲', '甲項');
  const mine = env.post({ action: 'mySignups', name: '測試甲' }).data.items[0];
  assert.equal(mine.multiPos, true);
  const r = env.post({ action: 'changePosition', signupId: sid, positionId: pid('丙項') });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.signupId, sid);
  const s = env.get({ action: 'getDuty', id: duty.id }).data.signups.find((x) => x.id === sid);
  assert.equal(s.positionId, pid('丙項'));
  assert.equal(env.post({ action: 'changePosition', signupId: sid, positionId: pid('丙項') }).error.code, 'BAD_REQUEST');
});

test('換項目：額滿不能換；當天不能自己換（管理者可以）；可以還原', () => {
  const { env, call, pid, signup } = setup();
  signup('測試乙', '乙項');
  const sid = signup('測試甲', '甲項');
  const full = env.post({ action: 'changePosition', signupId: sid, positionId: pid('乙項') });
  assert.equal(full.error.code, 'VALIDATION');
  assert.match(JSON.stringify(full.error), /額滿/);

  assert.equal(call('adminChangePosition', { signupId: sid, positionId: pid('丙項') }).ok, true);
  const log = call('adminLogs').data.logs.find((l) => l.action === '換項目');
  assert.ok(log && log.restorable, JSON.stringify(log));
  assert.match(log.summary, /甲項 → 丙項/);
  assert.equal(call('adminRestore', { row: log.row, signupId: log.signupId }).ok, true);
  const mine = env.post({ action: 'mySignups', name: '測試甲' }).data.items[0];
  assert.equal(mine.positionName, '甲項');

  env.clock.now = Date.UTC(2026, 10, 20, 2, 0, 0);
  assert.equal(env.post({ action: 'changePosition', signupId: sid, positionId: pid('丙項') }).error.code, 'FORBIDDEN');
});

test('換項目：只有一個項目的勤務不能換', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const id = env.post({ action: 'adminCreateDuties', token, duties: [{ name: '單項', category: '勤務', start: '2026-11-20', end: '2026-11-20', positions: [{ name: '了愿' }] }] }).data.ids[0];
  const d = env.get({ action: 'getDuty', id }).data;
  const r = env.post({ action: 'signup', dutyId: id, positionId: d.positions[0].id, dates: ['2026-11-20'], entries: [{ name: '測試甲', identity: '道親' }] });
  const sid = r.data.created[0].id;
  assert.equal(env.post({ action: 'mySignups', name: '測試甲' }).data.items[0].multiPos, false);
  assert.equal(env.post({ action: 'changePosition', signupId: sid, positionId: d.positions[0].id }).error.code, 'BAD_REQUEST');
});

test('換項目：最新報名、每天彙整也列出來（原本 → 新的）', () => {
  const { env, call, pid, signup } = setup();
  const sid = signup('測試甲', '甲項');
  assert.equal(call('adminChangePosition', { signupId: sid, positionId: pid('丙項') }).ok, true);
  const x = call('adminRecentSignups').data.items.find((i) => i.action === '換項目');
  assert.ok(x, '最新報名要有換項目');
  assert.equal(x.name, '測試甲');
  assert.equal(x.position, '甲項 → 丙項');
  assert.equal(x.dutyName, '測試活動');
  const text = env.fn('signupDigestText_')([x]);
  assert.match(text, /1 筆換項目/);
  assert.match(text, /⇄測試甲 .*甲項 → 丙項/);
});

test('調整項目（可兼任）：一次加報、拿掉；一換一就是換項目；全部不勾＝取消那天', () => {
  const { env, call, duty, pid, signup } = setup({ multi: true });
  const a = signup('測試甲', '甲項');
  env.post({ action: 'signup', dutyId: duty.id, positionId: pid('丙項'), dates: ['2026-11-20'], entries: [{ name: '測試甲', identity: '道親' }] });
  const items = () => env.post({ action: 'mySignups', name: '測試甲' }).data.items;
  assert.equal(items().length, 2);
  assert.equal(items()[0].multi, true);
  const names = () => items().map((x) => x.positionName).sort();

  // 一換一：丙 → 乙（原本那筆直接改，記換項目）
  const r1 = env.post({ action: 'adjustPositions', signupId: a, positionIds: [pid('甲項'), pid('乙項')] });
  assert.equal(r1.ok, true, JSON.stringify(r1.error));
  assert.deepEqual(names(), ['乙項', '甲項']);
  const logs = () => call('adminLogs').data.logs;
  assert.ok(logs().some((l) => l.action === '換項目' && /丙項 → 乙項/.test(l.summary)));

  // 加報＋拿掉兩個以上：拿掉甲、乙，加丙（記取消、報名）
  const r2 = env.post({ action: 'adjustPositions', signupId: a, positionIds: [pid('丙項')] });
  assert.equal(r2.ok, true, JSON.stringify(r2.error));
  assert.deepEqual(names(), ['丙項']);
  // 額滿的不能加：乙項最多 1，別人先報
  signup('測試乙', '乙項');
  const sid = items()[0].signupId;
  const full = env.post({ action: 'adjustPositions', signupId: sid, positionIds: [pid('丙項'), pid('乙項')] });
  assert.equal(full.error.code, 'VALIDATION');
  assert.deepEqual(names(), ['丙項'], '整筆不動');
  // 沒變更
  assert.equal(env.post({ action: 'adjustPositions', signupId: sid, positionIds: [pid('丙項')] }).error.code, 'BAD_REQUEST');
  // 全部不勾＝取消
  assert.equal(env.post({ action: 'adjustPositions', signupId: sid, positionIds: [] }).ok, true);
  assert.equal(items().length, 0);
});

test('調整項目：不可兼任的勤務不能用（用換項目）', () => {
  const { env, pid, signup } = setup();
  const a = signup('測試甲', '甲項');
  assert.equal(env.post({ action: 'adjustPositions', signupId: a, positionIds: [pid('甲項'), pid('丙項')] }).error.code, 'BAD_REQUEST');
});
