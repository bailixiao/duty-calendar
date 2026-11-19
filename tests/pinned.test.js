// 放到首頁（首頁置頂）：勤務管理列表直接開關（2026/11/19）。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('放到首頁：列表看得到、直接開關；首頁資料跟著變；寫操作紀錄', () => {
  const env = createEnv(OCT_1);
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  const made = call('adminCreateDuties', { duties: [{ name: '測試活動', category: '勤務', start: '2026-11-20', end: '2026-11-20', positions: [{ name: '了愿' }] }] });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const id = made.data.ids[0];
  const listed = () => call('adminDutyList').data.duties.find((d) => d.id === id);
  const home = () => env.get({ action: 'getEvents', from: '2026-11-20', to: '2026-11-20' }).data.duties.find((d) => d.id === id);
  assert.equal(listed().pinned, false);

  const on = call('adminSetPinned', { id, pinned: true });
  assert.equal(on.ok, true, JSON.stringify(on.error));
  assert.equal(listed().pinned, true);
  assert.equal(home().pinned, true);
  // 編輯頁也看得到勾起來
  assert.equal(call('adminDutyForEdit', { id }).data.duty.pinned, '是');

  assert.equal(call('adminSetPinned', { id, pinned: false }).data.pinned, false);
  assert.equal(home().pinned, false);
  assert.equal(call('adminSetPinned', { id: 'nope', pinned: true }).error.code, 'NOT_FOUND');
  const logs = call('adminLogs').data.logs.map((l) => JSON.stringify(l)).join('\n');
  assert.match(logs, /放到首頁/);
  assert.match(logs, /從首頁拿掉/);
});

test('放到首頁：唯讀帳號不能改；道務帳號不能改勤務類的', () => {
  const env = createEnv(OCT_1);
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (token, action, body) => env.post(Object.assign({ action, token }, body));
  const id = call(sup, 'adminCreateDuties', { duties: [{ name: '測試活動', category: '勤務', start: '2026-11-20', end: '2026-11-20', positions: [{ name: '了愿' }] }] }).data.ids[0];
  for (const [account, role] of [['唯讀組', '唯讀'], ['道務組', '道務']]) {
    call(sup, 'adminSaveAccount', { account: { account, role, password: 'pass-1234' } });
    const tok = env.post({ action: 'adminLogin', account, password: 'pass-1234' }).data.token;
    assert.equal(call(tok, 'adminSetPinned', { id, pinned: true }).error.code, 'FORBIDDEN', role);
  }
});
