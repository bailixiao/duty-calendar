// 年度總結、新朋友、完整備份、帳號安全、給分壇的公開資料。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

global.window = global.window || {};
global.window.SITE = { org: '測試區', venue: '區中心', categoryLabels: { 勤務: '總務・勤務', 道務: '道務', 教育: '教育' } };
global.StatsCalc = require('../js/stats-calc.js');
global.Fmt = { esc: (s) => String(s), shortDate: (d) => d };
const R = require('../js/admin-report.js');

const ev = (date, category, dao, name) => ({ date, category, name: name || '測試聚會', tan: [], dao, unknown: [] });

test('年度總結：各類別、每月人次、最常來的、新朋友；最近 30 天新朋友有沒有再來', () => {
  const events = [ev('2025-12-01', '勤務', ['測試甲']), ev('2026-03-01', '勤務', ['測試甲', '測試乙']), ev('2026-03-08', '道務', ['測試乙']), ev('2026-10-01', '教育', ['測試丙']), ev('2026-10-05', '勤務', ['測試丁']), ev('2026-10-08', '勤務', ['測試丁'])];
  const m = R.model(events, 2026);
  assert.equal(m.total, 6);
  assert.deepEqual(m.byCat.map((c) => [c.cat, c.events, c.attend, c.unique]), [['勤務', 3, 4, 3], ['道務', 1, 1, 1], ['教育', 1, 1, 1]]);
  assert.equal(m.months[2], 3);
  assert.deepEqual(m.top[0], ['測試乙', 2]);
  assert.deepEqual(m.newcomers.map((x) => x.name), ['測試乙', '測試丙', '測試丁'], '測試甲去年就來過');
  const recent = R.recentNewcomers(events, '2026-10-13', 30);
  assert.deepEqual(recent.map((x) => [x.name, x.again]), [['測試丁', true], ['測試丙', false]]);
  assert.match(R.text(m), /全年出席 6 人次/);
});

test('後台名單標新朋友；完整備份不含密碼；太簡單的密碼不行；場地整年統計；給分壇的公開資料', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const d = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-31' }).data.duties.find((x) => x.mode !== '公告型' && Object.keys(x.days).length);
  const date = Object.keys(d.days)[0];
  env.post({ action: 'signup', dutyId: d.id, positionId: d.positions[0].id, dates: [date], entries: [{ name: '測試新朋友', identity: '道親' }] });
  const s = call('adminDuty', { id: d.id }).data.signups.find((x) => x.name === '測試新朋友');
  assert.equal(s.first, true);
  // 密碼
  assert.equal(call('adminSaveAccount', { account: { account: '測試帳號', role: '勤務', password: '12345678' } }).error.code, 'VALIDATION');
  assert.equal(call('adminSaveAccount', { account: { account: '測試帳號', role: '勤務', password: 'short1' } }).error.code, 'VALIDATION');
  assert.equal(call('adminSaveAccount', { account: { account: '測試帳號', role: '勤務', password: 'tea-time-88' } }).ok, true);
  // 備份
  const b = call('adminBackup', {}).data;
  const acc = b.tables.find((t) => t.name === '帳號');
  assert.equal(acc.headers.indexOf('密碼雜湊'), -1);
  assert.ok(b.tables.find((t) => t.name === '報名').rows.length > 0);
  const dutyTok = env.post({ action: 'adminLogin', account: '測試帳號', password: 'tea-time-88' }).data.token;
  assert.equal(env.post({ action: 'adminBackup', token: dutyTok }).error.code, 'FORBIDDEN', '只有總管理者');
  // 場地整年
  env.post({ action: 'requestVenue', dates: ['2026-10-20', '2026-11-03'], slots: ['09:00', '10:00'], name: '測試甲', phone: '0912345678', purpose: '讀經' });
  call('adminVenueDecide', { ids: call('adminVenue', {}).data.requests.map((r) => r.id), decision: '已同意' });
  assert.equal(call('adminVenueStats', { year: 2026 }).data.items.length, 2);
  // 公開資料
  const f = env.get({ action: 'feed', from: '2026-10-13', to: '2026-10-31' }).data;
  assert.ok(f.events.length > 0);
  assert.ok(f.events.every((e) => e.url.indexOf('#/duty/') !== -1 && e.status));
  assert.equal(JSON.stringify(f).indexOf('測試新朋友'), -1, '不含人名');
});

test('好久不見的老朋友：3 個月前往回一年內來 5 次以上、最近 90 天沒來', () => {
  const many = (name, dates) => dates.map((d) => ev(d, '勤務', [name]));
  const events = [
    ...many('測試甲', ['2026-01-04', '2026-02-01', '2026-03-01', '2026-04-05', '2026-05-03']), // 5 次，之後沒來
    ...many('測試乙', ['2026-01-04', '2026-02-01', '2026-03-01', '2026-04-05', '2026-05-03', '2026-09-20']), // 最近有來
    ...many('測試丙', ['2026-02-01', '2026-03-01', '2026-04-05', '2026-05-03']), // 只有 4 次
    ...many('測試丁', ['2025-01-05', '2025-02-02', '2025-03-02', '2025-04-06', '2025-05-04', '2025-06-01', '2026-06-07']) // 一年多前的不算，只剩 1 次
  ];
  const list = R.longAbsent(events, '2026-10-13', 5);
  assert.deepEqual(list.map((x) => [x.name, x.times, x.last]), [['測試甲', 5, '2026-05-03']]);
});
