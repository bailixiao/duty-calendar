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
