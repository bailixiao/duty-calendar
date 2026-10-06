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
  assert.equal(env.post({ action: 'adminSaveMember', token: tok, member: { name: '測試甲' } }).ok, true, '道務帳號可以編輯成員（2026/10/6）');
  assert.equal(env.post({ action: 'adminSaveAccount', token: tok, account: { account: 'abc', role: '道務', password: 'abc12345' } }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminMembers', token: tok }).ok, true); // 可以看
  assert.equal(env.post({ action: 'adminLogs', token: tok }).error.code, 'FORBIDDEN'); // 操作紀錄、明日名單只給總管理者
  assert.equal(env.post({ action: 'adminDay', token: tok, date: '2026-10-02' }).error.code, 'FORBIDDEN');
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  const s = env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試乙' }] });
  assert.equal(env.post({ action: 'adminCancel', token: tok, signupId: s.data.created[0].id }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminCancel', token: superTok, signupId: s.data.created[0].id }).ok, true);
});

test('登入畫面的帳號清單：總管理者＋啟用中的帳號，只有名稱', () => {
  const { env, save } = setup();
  save({ account: '道務', role: '道務', password: 'abc12345' });
  save({ account: '點傳師', role: '唯讀', password: 'abc12345' });
  save({ account: '舊帳號', role: '教育', password: 'abc12345', active: false });
  const r = env.get({ action: 'loginAccounts' });
  save({ account: '勤務', role: '勤務', password: 'abc12345' }); // 後建立但角色排前面
  assert.deepEqual(env.get({ action: 'loginAccounts' }).data.accounts, ['總管理者', '勤務', '道務', '點傳師']);
  assert.equal(JSON.stringify(r).includes('唯讀'), false);
});

test('唯讀：什麼都能看、什麼都不能改', () => {
  const { env, login, superTok, save } = setup();
  save({ account: '查看用', role: '唯讀', password: 'abc12345' });
  const tok = login('查看用', 'abc12345').data.token;
  assert.equal(env.post({ action: 'adminDutyList', token: tok }).error.code, 'FORBIDDEN'); // 勤務管理看不到
  const list = env.post({ action: 'adminRecent', token: tok });
  assert.ok(list.data.duties.length > 3);
  assert.equal(env.post({ action: 'adminDuty', token: tok, id: list.data.duties[0].id }).ok, true);
  assert.equal(env.post({ action: 'adminStats', token: tok }).ok, true);
  assert.equal(env.post({ action: 'adminDeleteDuty', token: tok, id: list.data.duties[0].id }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminCreateDuties', token: tok, duties: [{ name: 'x', start: '2026-11-20' }] }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminMe', token: tok }).data.role, '唯讀');
  assert.equal(env.post({ action: 'adminLogs', token: tok }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminDay', token: tok, date: '2026-10-02' }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminAccounts', token: superTok }).data.accounts.length, 1);
});

test('停用或改密碼：那個帳號現有的登入失效；每個帳號各自一台裝置', () => {
  const { env, login, save } = setup();
  save({ account: '勤務組', role: '勤務', password: 'abc12345' });
  const a1 = login('勤務組', 'abc12345').data.token;
  login('', 'test-pass'); // 別的帳號登入，不會把勤務組踢掉
  assert.equal(env.post({ action: 'adminPing', token: a1 }).ok, true);
  assert.equal(env.post({ action: 'adminLogs', token: a1 }).error.code, 'FORBIDDEN'); // 操作紀錄、明日名單只給總管理者
  assert.equal(env.post({ action: 'adminDay', token: a1, date: '2026-10-02' }).error.code, 'FORBIDDEN');
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

test('道務、教育的活動自由參加：不算缺人', () => {
  const { env, superTok } = setup();
  const c = env.post({ action: 'adminCreateDuties', token: superTok, duties: [{ name: '週日法會', category: '道務', start: '2026-11-22', end: '2026-11-22', positions: [{ name: '參加', min: 5 }] }] });
  assert.equal(c.ok, true, JSON.stringify(c.error));
  const d = env.get({ action: 'getEvents', from: '2026-11-22', to: '2026-11-22' }).data.duties.find((x) => x.name === '週日法會');
  assert.equal(d.category, '道務');
  assert.equal(d.days['2026-11-22'].shortage, 0);
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

test('各佛堂道務目標：道務能看能改、唯讀只能看、勤務教育看不到；總計交給前端；整年取代', () => {
  const { env, login, superTok, save } = setup();
  save({ account: '道務組', role: '道務', password: 'abc12345' });
  save({ account: '教育組', role: '教育', password: 'abc12345' });
  save({ account: '查看用', role: '唯讀', password: 'abc12345' });
  const dao = login('道務組', 'abc12345').data.token;
  const edu = login('教育組', 'abc12345').data.token;
  const ro = login('查看用', 'abc12345').data.token;
  const rows = [
    { name: '測試甲佛堂', values: { 渡人: { target: '5', current: '2' }, 明道班: { target: '3', current: '' } }, vow: '壇主 測試乙' },
    { name: '測試丙', values: { 渡人: { target: '21', current: '4' } }, group: '海外' },
    { name: '測試丁', values: {}, group: '海外' }
  ];
  const r = env.post({ action: 'adminSaveGoals', token: dao, year: 2026, rows });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.rows.map((x) => [x.name, x.values.渡人.target, x.group]), [['測試甲佛堂', '5', ''], ['測試丙', '21', '海外'], ['測試丁', '', '海外']]);
  assert.equal(env.post({ action: 'adminGoals', token: ro, year: 2026 }).data.rows[0].vow, '壇主 測試乙');
  assert.equal(env.post({ action: 'adminSaveGoals', token: ro, year: 2026, rows }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminSaveGoals', token: edu, year: 2026, rows }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminGoals', token: edu, year: 2026 }).error.code, 'FORBIDDEN');
  assert.equal(env.post({ action: 'adminSaveGoals', token: superTok, year: 2026, rows: [{ name: 'x', values: { 渡人: { target: 'abc' } } }] }).error.code, 'VALIDATION');
  // 整年取代：再存一次只剩一列
  env.post({ action: 'adminSaveGoals', token: superTok, year: 2026, rows: rows.slice(0, 1) });
  assert.equal(env.post({ action: 'adminGoals', token: superTok, year: 2026 }).data.rows.length, 1);
  assert.deepEqual(env.post({ action: 'adminGoals', token: superTok, year: 2027 }).data.rows, []);
});
