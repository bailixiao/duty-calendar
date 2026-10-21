// 複製通知（js/share.js inviteText）：有負責組、組長就寫上。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { SITE: { inviteTitle: '測試', categoryLabels: {} } };
global.location = { origin: 'https://example.test', pathname: '/' };
require('../js/format.js');
global.Fmt = global.window.Fmt;
require('../js/share.js');
const S = global.window.Share;

const duty = (extra) => Object.assign({ id: 'D-1', name: '初一十五打掃（區中心）', category: '勤務', mode: '報名型', start: '2026-11-09', end: '2026-11-09', startTime: '', endTime: '', location: '區中心', positions: [{ id: 'P-1', name: '打掃', min: 2, max: null }], days: { '2026-11-09': { total: 0, counts: {} } } }, extra);

test('複製通知：有負責組和組長就寫進去，沒有就不寫', () => {
  const t = S.inviteText([{ duty: duty({ group: '第1組', groupType: '打掃組', groupLeader: '測試組長' }), date: '2026-11-09' }]);
  assert.match(t, /👥 負責組：第1組（打掃組）/);
  assert.match(t, /👤 組長：測試組長/);
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
