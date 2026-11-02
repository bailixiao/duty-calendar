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
  const empty = all.days.flatMap((d) => d.duties).filter((x) => !x.notice && !x.names.length);
  assert.ok(empty.length > 0, '還沒有人報名的勤務也要列出來');
  global.window = { SITE: { org: '教全區' } };
  global.Fmt = { shortDate: (d) => d, esc: (x) => x };
  const AP = require('../js/admin-pages.js');
  const P = global.window.AdminPages || AP;
  const list = P.byDuty([
    { date: '2026-10-02', duties: [{ name: '測試勤務', names: [] }, { name: '輪值', notice: true, group: '第二組', names: [] }, { name: '初一十五打掃（宏宗）', names: [] }] },
    { date: '2026-10-03', duties: [{ name: '測試勤務', names: ['測試甲', '測試乙'] }] }
  ]);
  assert.deepEqual(list.map((g) => g.name), ['測試勤務', '輪值'], '依勤務分開，初一十五打掃不列');
  const mixed = [{ date: '2026-10-02', duties: [{ name: '測試勤務', names: [] }, { name: '測試法會', category: '道務', names: [] }, { name: '測試課程', category: '教育', names: [] }] }];
  assert.deepEqual(P.byDuty(mixed, '勤務').map((g) => g.name), ['測試勤務'], '沒有類別的算總務');
  assert.deepEqual(P.byDuty(mixed, '道務').map((g) => g.name), ['測試法會']);
  assert.equal(P.rosterText(list), '教全區\n【測試勤務】\n2026-10-02：還沒有人報名\n2026-10-03：測試甲、測試乙\n【輪值】\n2026-10-02：第二組輪值');
  const dw = env.post({ action: 'adminLogin', account: '道務組', password: 'abc12345' }).data.token;
  const mine = env.post({ action: 'adminRoster', token: dw }).data;
  assert.ok(mine.days.every((d) => d.duties.every((x) => x.category === '道務')), '道務帳號只看到道務');
  const ro = env.post({ action: 'adminLogin', account: '看看', password: 'abc12345' }).data.token;
  assert.equal(env.post({ action: 'adminRoster', token: ro }).error.code, 'FORBIDDEN');
});

test('名單：登記張數的勤務寫每人幾張、總張數和合計金額', () => {
  const env = createEnv(OCT_1);
  const tok = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const id = env.post({ action: 'adminCreateDuties', token: tok, duties: [{ name: '測試園遊券', category: '勤務', nature: '活動', mode: '報名型', start: '2026-10-20', positions: [{ name: '參加', min: 0, max: null }], tickets: true, price: '100' }] }).data.ids[0];
  const pid = env.get({ action: 'getDuty', id }).data.positions[0].id;
  assert.equal(env.post({ action: 'signup', dutyId: id, positionId: pid, dates: ['2026-10-20'], entries: [{ name: '測試甲', identity: '道親', tickets: 3 }, { name: '測試乙', identity: '道親' }] }).ok, true);
  const x = env.post({ action: 'adminRoster', token: tok }).data.days.find((d) => d.date === '2026-10-20').duties.find((d) => d.id === id);
  assert.deepEqual([x.tickets, x.price], [{ 測試甲: 3, 測試乙: 1 }, 100]);
  assert.deepEqual(x.temples, { 測試甲: '', 測試乙: '' });
  if (!global.window || !global.window.AdminPages) { global.window = { SITE: { org: '教全區' } }; global.Fmt = { shortDate: (d) => d, esc: (v) => v }; require('../js/admin-pages.js'); }
  const P = global.window.AdminPages;
  assert.equal(P.rosterText(P.byDuty([{ date: '2026-10-20', duties: [x] }])), '教全區\n【測試園遊券】\n2026-10-20\n未填佛堂\n測試甲 3張、測試乙 1張\n小計 4 張・400 元\n共 4 張・400 元');
});
