// 📚 從教全區借範本（2026/11/21）：公開的範本清單只列用過 2 次以上的；農曆日期拿掉算同一種；不給負責組、人名、DM。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('範本：用過 2 次以上才列；同一種取最近一筆；拜香輪值的月份拿掉；不給負責組、講師', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const mk = (d) => {
    const r = env.post({ action: 'adminCreateDuties', token, duties: [Object.assign({ category: '勤務', positions: [{ name: '打掃', max: 4 }] }, d)] });
    assert.equal(r.ok, true, JSON.stringify(r.error));
  };
  mk({ name: '測試打掃', start: '2026-10-03', startTime: '08:00', location: '甲地' });
  mk({ name: '測試打掃', start: '2026-11-07', startTime: '09:00', location: '乙地', groupType: '勤務了愿組', group: '第1組' });
  mk({ name: '測試壇主天道加披', start: '2026-10-10' });
  mk({ name: '九月初一測試拜香', start: '2026-10-10', mode: '公告型' });
  mk({ name: '十月初一測試拜香', start: '2026-11-09', mode: '公告型' });
  const list = env.get({ action: 'templates' }).data.templates;
  const t = list.find((x) => x.name === '測試打掃');
  assert.ok(t);
  assert.equal(t.count, 2);
  assert.equal(t.startTime, '09:00', '取最近一筆');
  assert.equal(t.location, '乙地');
  assert.deepEqual(t.positions.map((p) => [p.name, String(p.max)]), [['打掃', '4']]);
  for (const k of ['group', 'groupType', 'lecturers', 'leaders', 'teachers', 'dm', 'start', 'id']) assert.equal(t[k], undefined, k);
  assert.ok(!list.some((x) => /加披/.test(x.name)), '只用過一次的不列');
  assert.equal(list.find((x) => x.name === '測試拜香').count, 2);
});
