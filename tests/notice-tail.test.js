// 總務佈達「每次都要加在最後的話」存在後台（apps-script/NoticeTail.gs）。執行：node --test
// 測試用的內容一律用假的，本儲存庫不放真實人名、電話。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('佈達最後的話：總管理者、勤務帳號能存，大家共用；道務只能看', () => {
  const env = createEnv(Date.UTC(2026, 10, 2, 2, 0, 0));
  const sup = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  env.post({ action: 'adminSaveAccount', token: sup, account: { account: '總務組', role: '勤務', password: 'abc12345' } });
  env.post({ action: 'adminSaveAccount', token: sup, account: { account: '道務組', role: '道務', password: 'abc12345' } });
  assert.equal(env.post({ action: 'adminNoticeTail', token: sup }).data.text, '');
  const w = env.post({ action: 'adminLogin', account: '總務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminNoticeTail', token: w, text: '  測試提醒：先到工具間報到\r\n  ' }).data.text, '測試提醒：先到工具間報到');
  assert.equal(env.post({ action: 'adminNoticeTail', token: sup }).data.text, '測試提醒：先到工具間報到');
  const d = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminNoticeTail', token: d }).data.text, '測試提醒：先到工具間報到');
  assert.equal(env.post({ action: 'adminNoticeTail', token: d, text: '改掉' }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminNoticeTail', token: sup, text: 'x'.repeat(1001) }).error.code, 'BAD_REQUEST');
});
