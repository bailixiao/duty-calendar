// 教育組的關心名單（2026/11/23）：js/edu-care.js 依生日、學齡算名單；apps-script/EduCare.gs 存已關心和日期設定。測試用假名。
const test = require('node:test');
const assert = require('node:assert/strict');
const EduCare = require('../js/edu-care.js');
const Family = require('../js/family.js');
const EduStats = require('../js/edu-stats.js');
const { createEnv } = require('./env');

const build = (members, today, config) => EduCare.build(members, today, config, Family.schoolStage, EduStats.AGE_CLASSES);
const group = (gs, id) => (gs.find((g) => g.id === id) || { items: [] }).items.map((x) => x.name);

test('升學年：國三、高三整個學年都列，每學期記一次；升國中只在 6～8 月', () => {
  const ms = [{ name: '測試國三', birthYear: 2012 }, { name: '測試高三', birthYear: 2009 }, { name: '測試國二', birthYear: 2013 }, { name: '測試小六', birthYear: 2015 }, { name: '測試停用', birthYear: 2012, active: false }];
  // 2026 年 11 月（學年 2026 上學期）：2012 年生的國三、2009 年生的高三
  let gs = build(ms, '2026-11-23');
  assert.deepEqual(group(gs, 'g9'), ['測試國三']);
  assert.deepEqual(group(gs, 'g12'), ['測試高三']);
  assert.equal(gs.find((g) => g.id === 'g9').items[0].key, '測試國三|g9|2026-1');
  assert.match(gs.find((g) => g.id === 'g9').items[0].reason, /上學期/);
  gs = build(ms, '2027-05-01');
  assert.equal(gs.find((g) => g.id === 'g9').items[0].key, '測試國三|g9|2026-2', '下學期再關心一次');
  assert.deepEqual(group(gs, 'g6'), [], '升國中 6 月才列');
  assert.deepEqual(group(build(ms, '2027-07-01'), 'g6'), ['測試小六']);
});

test('生日：前 3 天到後 7 天、35 歲以下；升班銜接：6～8 月列 9 月要換班的、9～10 月列剛升上的', () => {
  const ms = [
    { name: '測試壽星', birthYear: 2015, birthday: '11-25' }, { name: '測試過了', birthYear: 2015, birthday: '11-01' },
    { name: '測試長輩', birthYear: 1950, birthday: '11-24' }, { name: '測試跨年', birthYear: 2010, birthday: '01-02' },
    { name: '測試小四', birthYear: 2017 }, { name: '測試國三', birthYear: 2012 }
  ];
  const gs = build(ms, '2026-11-23');
  assert.deepEqual(group(gs, 'bday'), ['測試壽星'], '長輩不列、太久以前的不列');
  assert.match(gs.find((g) => g.id === 'bday').items[0].reason, /11\/25 生日（還有 2 天）・滿 11 歲/);
  assert.deepEqual(group(build(ms, '2026-12-28'), 'bday'), ['測試跨年'], '跨年也找得到');
  // 2027 年 7 月：2017 年生的國小 4 年級，9 月升 5 年級＝讀經班 → 青少年班；2012 年生的國三 → 高大班
  let mv = build(ms, '2027-07-10').find((g) => g.id === 'move');
  assert.deepEqual(mv.items.map((x) => [x.name, x.reason]), [['測試小四', '9 月要從讀經班升到青少年班'], ['測試國三', '9 月要從青少年班升到高大班']]);
  mv = build(ms, '2027-09-10').find((g) => g.id === 'move');
  assert.deepEqual(mv.items.map((x) => x.reason), ['剛升上青少年班（原本讀經班）', '剛升上高大班（原本青少年班）']);
  assert.equal(build(ms, '2027-12-10').find((g) => g.id === 'move'), undefined, '11 月以後不列');
});

test('已關心：教育帳號可以記（寫進成員的成全紀錄）、可以取消；勤務帳號不行', () => {
  const env = createEnv(Date.UTC(2026, 10, 23, 2, 0, 0));
  const token = env.post({ action: 'adminLogin', password: 'test-pass' }).data.token;
  const call = (action, body, tok) => env.post(Object.assign({ action, token: tok || token }, body));
  call('adminSaveMember', { member: { name: '測試國三', identity: '道親', birth: '2011' } });
  let r = call('adminEduCare', { key: '測試國三|cap|2026', name: '測試國三', label: '國中會考・考前', note: '打電話打氣' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.care['測試國三|cap|2026'].note, '打電話打氣');
  const m = call('adminMembers').data.members.find((x) => x.name === '測試國三');
  assert.match(m.careNote, /^11\/23 國中會考・考前：打電話打氣（總管理者）/);
  r = call('adminEduCare', { key: '測試國三|cap|2026', name: '測試國三', undo: true });
  assert.equal(r.data.care['測試國三|cap|2026'], undefined);
  call('adminSaveAccount', { account: { account: '測試勤務', role: '勤務', password: 'test-pass-5' } });
  const tok = env.post({ action: 'adminLogin', account: '測試勤務', password: 'test-pass-5' }).data.token;
  assert.equal(call('adminEduCare', { key: 'x|cap|2026', name: 'x' }, tok).error.code, 'FORBIDDEN');
  assert.equal(call('adminEduCareList', {}, tok).data.canEdit, false);
});
