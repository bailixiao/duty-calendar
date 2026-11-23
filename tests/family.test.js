// 道二代、道三代與學齡（2026/11/22）
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./env');
const Family = require('../js/family.js');

test('學齡：依出生年和學年（9 月開始）推算', () => {
  const s = (by, d) => { const x = Family.schoolStage(by, d); return x && x.label; };
  assert.equal(s(2019, '2026-11-22'), '國小 2 年級');
  assert.equal(s(2019, '2026-08-31'), '國小 1 年級', '8 月還是上一學年');
  assert.equal(s(2014, '2026-11-22'), '國中 1 年級');
  assert.equal(s(2011, '2026-11-22'), '高中 1 年級');
  assert.equal(s(2008, '2026-11-22'), '大學 1 年級');
  assert.equal(s(2021, '2026-11-22'), '幼兒園');
  assert.equal(s(2025, '2026-11-22'), '學齡前');
  assert.equal(s(1990, '2026-11-22'), null, '成年不顯示');
  assert.equal(s('', '2026-11-22'), null);
});

test('第幾代：父母在名單上又有求道才算；父母填成環也不會當掉', () => {
  const ms = [
    { name: '測試阿公', identity: '壇辦', parents: [] },
    { name: '測試爸爸', identity: '道親', parents: ['測試阿公'] },
    { name: '測試媽媽', identity: '未求道', parents: [] },
    { name: '測試小孩', identity: '道親', parents: ['測試爸爸', '測試媽媽'] },
    { name: '測試新朋友小孩', identity: '未求道', parents: ['測試媽媽'] },
    { name: '測試環甲', identity: '道親', parents: ['測試環乙'] },
    { name: '測試環乙', identity: '道親', parents: ['測試環甲'] }
  ];
  const g = Family.generations(ms);
  const at = (n) => g.get(ms.find((m) => m.name === n));
  assert.equal(at('測試阿公').gen, 1);
  assert.equal(at('測試爸爸').label, '道二代');
  assert.equal(at('測試小孩').label, '道三代');
  assert.equal(at('測試新朋友小孩').gen, 1, '媽媽沒求道，不算道二代');
  assert.deepEqual(at('測試阿公').children.map((m) => m.name), ['測試爸爸']);
  assert.ok(at('測試環甲').gen >= 1);
});

test('父母、學校、興趣：存檔、只改家庭資料、改名時別人的父母欄跟著改、匯入', () => {
  const env = createEnv(Date.UTC(2026, 10, 22, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  call('adminSaveMember', { member: { name: '測試爸爸', identity: '壇辦' } });
  let r = call('adminSaveMember', { member: { name: '測試小孩', identity: '道親', age: '8', parents: '測試爸爸、測試小孩', school: '測試國小', interest: '畫畫' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const kid = () => call('adminMembers').data.members.find((m) => m.name === '測試小孩');
  assert.deepEqual([kid().parents, kid().school, kid().interest], [['測試爸爸'], '測試國小', '畫畫'], '父母不能填自己');

  r = call('adminSetFamily', { row: kid().row, original: '測試小孩', parents: '不在名單的人' });
  assert.equal(r.error.code, 'VALIDATION', '父母要在名單上');
  r = call('adminSetFamily', { row: kid().row, original: '測試小孩', school: '測試國中', age: '13' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual([kid().school, kid().age, kid().parents], ['測試國中', 13, ['測試爸爸']], '沒給的父母不會被清掉');

  const dad = call('adminMembers').data.members.find((m) => m.name === '測試爸爸');
  call('adminSaveMember', { row: dad.row, original: '測試爸爸', member: { name: '測試爸爸改', identity: '壇辦', groups: {}, active: true } });
  assert.deepEqual(kid().parents, ['測試爸爸改'], '爸爸改名，小孩的父母欄跟著改');

  call('adminSaveMember', { member: { name: '測試小孩二', identity: '道親' } });
  call('adminImportMembers', { items: [{ name: '測試小孩二', parents: ['測試爸爸改'], school: '測試高中' }] });
  const k2 = call('adminMembers').data.members.find((m) => m.name === '測試小孩二');
  assert.deepEqual([k2.parents, k2.school], [['測試爸爸改'], '測試高中']);
});

test('道二代、道三代只算 45 歲以下（沒填年齡的照算）；超過的照樣讓子女算得出代數', () => {
  const ms = [
    { name: '測試阿公', identity: '壇辦', age: 75, parents: [] },
    { name: '測試爸爸', identity: '道親', age: 50, parents: ['測試阿公'] },
    { name: '測試小孩', identity: '道親', age: 20, parents: ['測試爸爸'] },
    { name: '測試阿姨', identity: '道親', age: 45, parents: ['測試阿公'] },
    { name: '測試表弟', identity: '道親', age: '', parents: ['測試阿姨'] }
  ];
  const g = Family.generations(ms);
  const at = (n) => g.get(ms.find((m) => m.name === n));
  assert.deepEqual([at('測試爸爸').gen, at('測試爸爸').label, at('測試爸爸').shownGen], [2, '', 1], '50 歲不標道二代');
  assert.equal(at('測試小孩').label, '道三代', '爸爸超過 45 歲，小孩照樣是道三代');
  assert.equal(at('測試阿姨').label, '道二代', '45 歲還算');
  assert.equal(at('測試表弟').label, '道三代', '沒填年齡照算');
});

test('生日（月日，選填，2026/11/23）：存檔、檢查、匯入；只有年的不會清掉', () => {
  const env = createEnv(Date.UTC(2026, 10, 23, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body) => env.post(Object.assign({ action, token }, body));
  let r = call('adminSaveMember', { member: { name: '測試生日', identity: '道親', age: '30', birthday: '3/7' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const me = () => call('adminMembers').data.members.find((m) => m.name === '測試生日');
  assert.equal(me().birthday, '03-07');
  assert.equal(call('adminSaveMember', { row: me().row, original: '測試生日', member: { name: '測試生日', identity: '道親', birthday: '2/30' } }).error.code, 'VALIDATION');
  call('adminImportMembers', { items: [{ name: '測試生日', birthYear: 1990 }] });
  assert.equal(me().birthday, '03-07', '匯入只有年，月日留著');
  call('adminImportMembers', { items: [{ name: '測試生日', birthYear: 1990, birthday: '12-25' }] });
  assert.equal(me().birthday, '12-25');
  r = call('adminSaveMember', { row: me().row, original: '測試生日', member: { name: '測試生日', identity: '道親', birthday: '' } });
  assert.equal(me().birthday, '', '清掉');
});
