// 後台「名單」（apps-script/Admin.gs adminRoster_）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

test('名單：今天起一個月有人報名的日期，同名只列一次；類別帳號只看自己類別，唯讀不能看', () => {
  const env = createEnv(OCT_1);
  const superTok = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  env.post({ action: 'adminSaveAccount', token: superTok, account: { account: '道務組', role: '道務', password: 'abc12345' } });
  env.post({ action: 'adminSaveAccount', token: superTok, account: { account: '看看', role: '唯讀', password: 'abc12345' } });
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const r = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試乙' }, { name: '測試丙' }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const all = env.post({ action: 'adminRoster', token: superTok }).data;
  assert.equal(all.today, '2026-10-01');
  const day = all.days.find((d) => d.date === '2026-10-13');
  assert.deepEqual(day.duties.find((d) => d.id === ev.id).names, ['測試乙', '測試丙']);
  assert.ok(all.days.every((d) => d.date >= '2026-10-01' && d.date <= '2026-10-31'));
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  const mine = env.post({ action: 'adminRoster', token: dw }).data;
  assert.ok(mine.days.every((d) => d.duties.every((x) => x.category === '道務')), '道務帳號只看到道務');
  const ro = env.post({ action: 'adminLogin', account: '看看', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminRoster', token: ro }).error.code, 'FORBIDDEN');
});
