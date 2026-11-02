// 複製通知（js/share.js inviteText）：有負責組、組長就寫上。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { SITE: { inviteTitle: '測試', categoryLabels: {} } };
global.location = { origin: 'https://example.test', pathname: '/' };
require('../js/format.js');
global.Fmt = global.window.Fmt;
require('../js/share.js');
const S = global.window.Share;

const duty = (extra) => Object.assign({ id: 'D-1', name: '測試勤務', category: '勤務', mode: '報名型', start: '2026-11-09', end: '2026-11-09', startTime: '', endTime: '', location: '區中心', positions: [{ id: 'P-1', name: '打掃', min: 2, max: null }], days: { '2026-11-09': { total: 0, counts: {} } } }, extra);

test('複製通知：有負責組和組長就寫進去，沒有就不寫', () => {
  const t = S.inviteText([{ duty: duty({ group: '第1組', groupType: '打掃組', groupLeader: '測試組長' }), date: '2026-11-09' }]);
  assert.match(t, /👥 負責組：第1組（打掃組）/);
  assert.match(t, /👤 召集人：測試組長/, '打掃組叫召集人');
  assert.match(S.inviteText([{ duty: duty({ group: '第1組', groupType: '勤務了愿組', groupLeader: '測試組長' }), date: '2026-11-09' }]), /👤 組長：測試組長/);
  const none = S.inviteText([{ duty: duty({}), date: '2026-11-09' }]);
  assert.doesNotMatch(none, /負責組|組長/);
});

test('複製通知：陪同的人也列出來，寫「（陪同）」，不算人數', () => {
  const signups = [
    { date: '2026-11-09', positionId: 'P-1', name: '測試甲', accompany: false },
    { date: '2026-11-09', positionId: 'P-1', name: '測試乙', accompany: true }
  ];
  assert.deepEqual(S.rosterLines(duty({}), '2026-11-09', signups), ['・打掃了愿人員：測試甲、測試乙（陪同）']);
  assert.deepEqual(S.rosterLines(duty({}), '2026-11-09', [signups[1]]), ['・打掃了愿人員：測試乙（陪同）']);
});

test('需要人數：人數夠了自動不寫；後台勾了「不寫需要人數」就都不寫', () => {
  const short = duty({ days: { '2026-11-09': { total: 1, counts: { 'P-1': 1 } } } });
  const enough = duty({ days: { '2026-11-09': { total: 2, counts: { 'P-1': 2 } } } });
  assert.match(S.inviteText([{ duty: short, date: '2026-11-09' }]), /🙋 需要人數：還缺 1 位/);
  assert.doesNotMatch(S.inviteText([{ duty: enough, date: '2026-11-09' }]), /需要人數/);
  const store = {};
  global.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  store['duty-calendar:invite-no-need'] = '1';
  assert.doesNotMatch(S.inviteText([{ duty: short, date: '2026-11-09' }]), /需要人數/);
  delete global.localStorage;
});

test('複製通知：好幾天的勤務（12人小組）整週合成一則，寫還缺人的日子，不一天一天列', () => {
  const week = duty({ id: 'W-1', name: '12人小組輪值', start: '2026-11-08', end: '2026-11-10', location: '宏宗',
    days: { '2026-11-08': { total: 2, counts: { 'P-1': 2 } }, '2026-11-09': { total: 0, counts: {} }, '2026-11-10': { total: 1, counts: { 'P-1': 1 } } } });
  const rows = ['2026-11-08', '2026-11-09', '2026-11-10'].map((date) => ({ duty: week, date, signups: [] }));
  const t = S.inviteText(rows);
  assert.equal((t.match(/【12人小組輪值】/g) || []).length, 1);
  assert.match(t, /📅 日期：115\/11\/8（日）～11\/10（二）/);
  assert.match(t, /🙋 還需要人手：11\/9（一）、11\/10（二）/);
  assert.match(t, /#\/duty\/W-1\?go=signup/);
  assert.doesNotMatch(t, /了愿人員/);
  assert.match(t, /歡迎家人們踴躍參加 🙏$/);
});

test('複製通知：初一十五打掃寫「初一打掃」或「十五打掃」，不寫需要人數、目前報名、報名網址', () => {
  global.window.Solar = {};
  global.window.LunarUtil = { lunarOf: (d) => ({ isFirst: d === '2026-11-09', isFifteenth: d === '2026-11-23' }) };
  const signups = [{ date: '2026-11-09', positionId: 'P-1', name: '測試甲', accompany: false }];
  const t = S.inviteText([{ duty: duty({ name: '初一十五打掃（區中心）', group: '第2組', groupType: '打掃組', groupLeader: '測試組長' }), date: '2026-11-09', signups }]);
  assert.match(t, /^【初一打掃（區中心）】\n📅 日期：115\/11\/9（一）\n📍 地點：區中心\n👥 負責組：第2組（打掃組）\n👤 召集人：測試組長/);
  assert.doesNotMatch(t, /需要人數|目前報名|報名：|測試甲/);
  const d15 = duty({ name: '初一十五打掃（區中心）', start: '2026-11-23', end: '2026-11-23', days: { '2026-11-23': { total: 0, counts: {} } } });
  assert.match(S.inviteText([{ duty: d15, date: '2026-11-23' }]), /【十五打掃（區中心）】/);
  delete global.window.Solar;
  delete global.window.LunarUtil;
});

test('報名連結改短：j/?代碼（勤務ID去掉 D-20 和 -），指定哪一天再加 -yyMMdd；ID 格式不同用原本的網址', () => {
  assert.equal(S.signupUrl('D-20261001-e6d044'), 'https://example.test/j/?261001e6d044');
  assert.equal(S.signupUrl('D-20261001-e6d044', '2026-11-09'), 'https://example.test/j/?261001e6d044-261109');
  assert.equal(S.signupUrl('W-1', '2026-11-09'), 'https://example.test/?openExternalBrowser=1#/duty/W-1?date=2026-11-09&go=signup');
});
