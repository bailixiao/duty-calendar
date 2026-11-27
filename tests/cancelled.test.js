// 停課（2026/11/27）：勤務可以標停課／取消（原因選填）；行事曆標停課、不能報名、不算缺人、統計不算這一堂。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');
global.window = global.window || {};
require('../js/format.js');
const Fmt = global.window.Fmt;

test('停課：存得起來（原因選填）、取消勾選就恢復；行事曆不算缺人、不能報名、統計不算', () => {
  const env = createEnv(Date.UTC(2026, 11, 1, 2, 0, 0)); // 12/1
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const mk = (name, start, extra) => Object.assign({ name, category: '教育', nature: '課程', mode: '報名型', start, end: start, location: '測試地點', positions: [{ name: '參加', min: 2 }] }, extra);
  const made = call('adminCreateDuties', { duties: [mk('測試讀經班', '2026-12-12', { cancelled: true, cancelReason: '颱風' }), mk('測試讀經班', '2026-12-19'), mk('測試打掃', '2026-12-12', { category: '勤務', nature: '勤務', cancelled: true })] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const [idA, idB, idC] = made.data.ids;

  const ev = env.get({ action: 'getEvents', from: '2026-12-12', to: '2026-12-19' }).data.duties;
  const a = ev.find((d) => d.id === idA), b = ev.find((d) => d.id === idB), c = ev.find((d) => d.id === idC);
  assert.equal(a.cancelled, true);
  assert.equal(a.cancelReason, '颱風');
  assert.equal(b.cancelled, false);
  assert.equal(c.cancelReason, '', '沒寫原因就是空白');
  assert.equal(c.days['2026-12-12'].shortage, 0, '停課的勤務不算缺人');
  assert.deepEqual(Fmt.dayState(a, a.days['2026-12-12']), { kind: 'cancelled', label: '停課' });
  assert.deepEqual(Fmt.dayState(c, c.days['2026-12-12']), { kind: 'cancelled', label: '取消' }, '勤務寫取消');

  // 不能報名
  const r = env.post({ action: 'signup', dutyId: a.id, positionId: a.positions[0].id, dates: ['2026-12-12'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r.error), /停課/);
  const ok = env.post({ action: 'signup', dutyId: b.id, positionId: b.positions[0].id, dates: ['2026-12-19'], entries: [{ name: '測試甲', identity: '道親' }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.error));

  // 編輯畫面帶得出來；取消勾選存檔就恢復
  const edit = call('adminDutyForEdit', { id: idA }).data;
  const input = edit.duty || edit;
  assert.equal(input.cancelled, '颱風');
  const saved = call('adminUpdateDuty', { id: idA, duty: Object.assign({}, input, { cancelled: false, cancelReason: '' }) });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const again = env.get({ action: 'getEvents', from: '2026-12-12', to: '2026-12-12' }).data.duties.find((d) => d.id === idA);
  assert.equal(again.cancelled, false);

  // 統計：停課的那一堂不算
  call('adminUpdateDuty', { id: idA, duty: Object.assign({}, input, { cancelled: true, cancelReason: '' }) });
  env.clock.now = Date.UTC(2026, 11, 25, 2, 0, 0);
  const sessions = env.fn('eduSessions_')().filter((s) => s.name === '測試讀經班').map((s) => s.date);
  assert.deepEqual(sessions, ['2026-12-19']);
});
