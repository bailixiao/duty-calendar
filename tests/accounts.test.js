// 管理後台的帳號與權限：總管理者、勤務／道務／教育（只管自己類別）、唯讀（只能看）。
const test = require('node:test');
const assert = require('node:assert');
const { createEnv } = require('./env');

const OCT_1 = Date.UTC(2026, 9, 1, 2, 0, 0);

function setup() {
  const env = createEnv(OCT_1);
  const login = (account, password) => env.post({ action: 'adminLogin', account, password });
  const superTok = login('', 'test-pass').data.token;
  const save = (a) => env.post({ action: 'adminSaveAccount', token: superTok, account: a });
  return { env, login, superTok, save };
}

test('總管理者：原本的密碼照用（帳號留空或填「總管理者」）；可以建立帳號，密碼只存雜湊', () => {
  const { env, login, save } = setup();
  const r = save({ account: '道務組', name: '道務負責人', role: '道務', password: 'abc12345' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const row = env.sheets['帳號'].data[1];
  assert.equal(row[0], '道務組');
  assert.ok(!row.join('|').includes('abc12345'));
  assert.equal(r.data.accounts[0].role, '道務');
  assert.equal(save({ account: '道務組', role: '道務', password: 'abc12345' }).error.code, 'VALIDATION'); // 重複
  assert.equal(save({ account: 'x', role: '道務', password: 'abc12345' }).error.code, 'VALIDATION'); // 太短
  assert.equal(save({ account: '新帳號', role: '道務' }).error.code, 'VALIDATION'); // 沒密碼
  assert.equal(login('道務組', 'abc12345').data.role, '道務');
  assert.equal(login('道務組', 'wrong').error.message, '帳號或密碼不正確');
  assert.equal(login('', 'wrong').error.code, 'UNAUTHORIZED');
  assert.equal(login('總管理者', 'test-pass').data.role, '總管理者'); // 最後再測（會把前一個總管理者登入擠掉）
});

test('類別帳號：只能動自己類別的勤務；新增時類別固定成自己的；看不到別的類別', () => {
  const { env, login, superTok, save } = setup();
  save({ account: '道務組', role: '道務', password: 'abc12345' });
  const tok = login('道務組', 'abc12345').data.token;
  const list = env.post({ action: 'adminDutyList', token: superTok }).data.duties;
  const qinwu = list.find((d) => d.name === '彌勒山志工輪值'); // 現有的都是勤務類
  assert.equal(qinwu.category, '勤務');
  assert.equal(env.post({ action: 'adminDutyList', token: tok }).data.duties.length, 0);
  assert.equal(env.post({ action: 'adminDeleteDuty', token: tok, id: qinwu.id }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminDuty', token: tok, id: qinwu.id }).error.code, 'FORBIDDEN');
  const c = env.post({ action: 'adminCreateDuties', token: tok, duties: [{ name: '法會', category: '勤務', start: '2026-11-20', end: '2026-11-20', positions: [{ name: '了愿' }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const mine = env.post({ action: 'adminDutyList', token: tok }).data.duties;
  assert.deepEqual(mine.map((d) => [d.name, d.category]), [['法會', '道務']]);
  assert.equal(env.post({ action: 'adminDutyForEdit', token: tok, id: mine[0].id }).data.duty.category, '道務');
  assert.equal(env.post({ action: 'adminSaveMember', token: tok, member: { name: '測試甲' } }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminSaveAccount', token: tok, account: { account: 'abc', role: '道務', password: 'abc12345' } }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminMembers', token: tok }).ok, true); // 可以看
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const s = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試乙' }] });
  assert.equal(env.post({ action: 'adminCancel', token: tok, signupId: s.data.created[0].id }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminCancel', token: superTok, signupId: s.data.created[0].id }).ok, true);
});

test('唯讀：什麼都能看、什麼都不能改', () => {
  const { env, login, superTok, save } = setup();
  save({ account: '查看用', role: '唯讀', password: 'abc12345' });
  const tok = login('查看用', 'abc12345').data.token;
  const list = env.post({ action: 'adminDutyList', token: tok });
  assert.ok(list.data.duties.length > 10);
  assert.equal(env.post({ action: 'adminDuty', token: tok, id: list.data.duties[0].id }).ok, true);
  assert.equal(env.post({ action: 'adminStats', token: tok }).ok, true);
  assert.equal(env.post({ action: 'adminDeleteDuty', token: tok, id: list.data.duties[0].id }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminCreateDuties', token: tok, duties: [{ name: 'x', start: '2026-11-20' }] }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminMe', token: tok }).data.role, '唯讀');
  assert.equal(env.post({ action: 'adminAccounts', token: superTok }).data.accounts.length, 1);
});

test('停用或改密碼：那個帳號現有的登入失效；每個帳號各自一台裝置', () => {
  const { env, login, save } = setup();
  save({ account: '勤務組', role: '勤務', password: 'abc12345' });
  const a1 = login('勤務組', 'abc12345').data.token;
  login('', 'test-pass'); // 別的帳號登入，不會把勤務組踢掉
  assert.equal(env.post({ action: 'adminPing', token: a1 }).ok, true);
  const a2 = login('勤務組', 'abc12345').data.token; // 同帳號在別台登入：前一台失效
  assert.match(env.post({ action: 'adminPing', token: a1 }).error.message, /其他裝置/);
  const st = login('', 'test-pass').data.token;
  env.post({ action: 'adminSaveAccount', token: st, account: { account: '勤務組', original: '勤務組', role: '勤務', password: 'newpass99' } });
  assert.match(env.post({ action: 'adminPing', token: a2 }).error.message, /重新登入/);
  assert.equal(login('勤務組', 'abc12345').error.code, 'UNAUTHORIZED');
  const a3 = login('勤務組', 'newpass99').data.token;
  env.post({ action: 'adminSaveAccount', token: st, account: { account: '勤務組', original: '勤務組', role: '勤務', active: false } });
  assert.equal(env.post({ action: 'adminPing', token: a3 }).error.code, 'UNAUTHORIZED');
  assert.equal(login('勤務組', 'newpass99').error.code, 'UNAUTHORIZED');
});

test('行事曆公開資料帶類別；操作紀錄記下是哪個帳號', () => {
  const { env, login, save } = setup();
  assert.equal(env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties[0].category, '勤務');
  save({ account: '勤務組', role: '勤務', password: 'abc12345' });
  const tok = login('勤務組', 'abc12345').data.token;
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((x) => x.name === '彌勒山志工輪值');
  const s = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試丙' }] });
  assert.equal(env.post({ action: 'adminCancel', token: tok, signupId: s.data.created[0].id }).ok, true);
  const logs = env.sheets['操作紀錄'].data;
  assert.match(logs[logs.length - 1][3], /（勤務組）$/);
});
