// 後台「📢 通知」的邀請報名（js/admin-notify.js shortRows）。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { SITE: { inviteTitle: '測試', categoryLabels: {} } };
global.location = { origin: 'https://example.test', pathname: '/' };
require('../js/format.js');
global.Fmt = global.window.Fmt;
require('../js/share.js');
global.Share = global.window.Share;
const B = require('../js/admin-notify.js');

const pos = [{ id: 'P-1', name: '打掃', min: 2, max: null }];
const one = (id, date, n, extra) => Object.assign({ id, name: '勤務' + id, category: '勤務', mode: '報名型', start: date, end: date, positions: pos, days: { [date]: { total: n, counts: { 'P-1': n } } } }, extra);

test('邀請報名：只列還缺人的勤務，缺最多的排前面；好幾天的勤務合成一列', () => {
  const week = { id: 'W', name: '12人小組輪值', category: '勤務', mode: '報名型', start: '2026-11-08', end: '2026-11-10', positions: pos,
    days: { '2026-11-08': { total: 2, counts: { 'P-1': 2 } }, '2026-11-09': { total: 0, counts: {} }, '2026-11-10': { total: 1, counts: { 'P-1': 1 } } } };
  const duties = [
    one('A', '2026-11-05', 1), // 缺 1
    one('B', '2026-11-06', 2), // 夠了
    one('C', '2026-11-07', 0), // 缺 2
    week, // 缺 0+2+1＝3
    one('D', '2026-11-07', 0, { category: '道務' }), // 道務不算缺人
    one('E', '2026-11-07', 0, { mode: '公告型' }),
    one('F', '2026-11-09', 0, { name: '初一十五打掃（宏宗）' }) // 用總務佈達，不列
  ];
  const r = B.shortRows(duties, '2026-11-02', '2026-12-01', '總管理者');
  assert.deepEqual(r.map((x) => [x.duty.id, x.short]), [['W', 3], ['C', 2], ['A', 1]]);
  assert.deepEqual(r[0].dates, ['2026-11-09', '2026-11-10']);
  assert.equal(r[0].date, '2026-11-08');
});

test('邀請報名：勤務帳號只看勤務類；期間型勤務從今天算起', () => {
  const week = { id: 'W', name: '12人小組輪值', category: '勤務', mode: '報名型', start: '2026-11-01', end: '2026-11-04', positions: pos, days: {} };
  const r = B.shortRows([week, one('X', '2026-11-05', 0, { category: '' })], '2026-11-03', '2026-12-02', '勤務');
  assert.deepEqual(r.map((x) => [x.duty.id, x.date, x.dates.length]), [['W', '2026-11-03', 2], ['X', '2026-11-05', 1]]);
});
