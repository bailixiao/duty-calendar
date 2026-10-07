// 當天點名（apps-script/Rollcall.gs）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');

test('點名：後台產生點名碼；只有當天、點名碼對才能點；錯 5 次鎖住；改未到會寫操作紀錄', () => {
  const env = createEnv(Date.UTC(2026, 9, 1, 2, 0, 0)); // 10/1
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const ev = env.get({ action: 'getEvents', from: '2026-10-13', to: '2026-10-13' }).data.duties.find((d) => d.name === '彌勒山志工輪值');
  env.post({ action: 'signup', dutyId: ev.id, positionId: ev.positions[0].id, dates: ['2026-10-13'], entries: [{ name: '測試甲', identity: '道親' }, { name: '測試乙', identity: '道親' }] });
  const link = env.post({ action: 'adminRollcallLink', token, dutyId: ev.id, date: '2026-10-13' });
  assert.equal(link.ok, true, JSON.stringify(link.error));
  assert.match(link.data.code, /^\d{4}$/);
  assert.equal(env.post({ action: 'adminRollcallLink', token, dutyId: ev.id, date: '2026-10-13' }).data.code, link.data.code, '同一天固定一組');
  const p = { dutyId: ev.id, date: '2026-10-13', code: link.data.code };
  assert.match(env.post(Object.assign({ action: 'rollcallGet' }, p)).error.message, /當天/, '還沒到當天');

  env.clock.now = Date.UTC(2026, 9, 13, 1, 0, 0); // 10/13 早上
  const wrong = link.data.code === '1234' ? '5678' : '1234';
  const bad = env.post({ action: 'rollcallGet', dutyId: ev.id, date: '2026-10-13', code: wrong });
  assert.equal(bad.error.code, 'FORBIDDEN');
  const got = env.post(Object.assign({ action: 'rollcallGet' }, p));
  assert.equal(got.ok, true, JSON.stringify(got.error));
  const people = got.data.positions[0].people;
  assert.deepEqual(people.map((x) => [x.name, x.attend]), [['測試甲', '出席'], ['測試乙', '出席']]);
  assert.doesNotMatch(JSON.stringify(got.data), /09\d{2}-?\d{3}-?\d{3}/, '不回傳電話');
  const set = env.post(Object.assign({ action: 'rollcallSet', signupId: people[1].id, attend: '未到' }, p));
  assert.equal(set.data.positions[0].people[1].attend, '未到');
  const logs = env.post({ action: 'adminLogs', token, offset: 0, limit: 5 }).data.logs;
  assert.ok(logs.some((l) => /點名：未到/.test(l.summary || l['內容摘要'] || JSON.stringify(l))));

  for (let i = 0; i < 5; i++) env.post({ action: 'rollcallGet', dutyId: ev.id, date: '2026-10-13', code: '0000' === link.data.code ? '1111' : '0000' });
  assert.equal(env.post(Object.assign({ action: 'rollcallGet' }, p)).error.code, 'BUSY', '錯太多次鎖住');
});
