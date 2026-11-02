// 後台「📢 通知」的佈達（js/admin-notify.js listRows）。執行：node --test
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

test('佈達：依類別分（總務／道務／教育），依日期排；總務標出還缺幾位，好幾天的勤務合成一列', () => {
  const week = { id: 'W', name: '12人小組輪值', category: '勤務', mode: '報名型', start: '2026-11-08', end: '2026-11-10', positions: pos,
    days: { '2026-11-08': { total: 2, counts: { 'P-1': 2 } }, '2026-11-09': { total: 0, counts: {} }, '2026-11-10': { total: 1, counts: { 'P-1': 1 } } } };
  const duties = [
    one('C', '2026-11-07', 0),
    one('A', '2026-11-05', 1),
    one('B', '2026-11-06', 2), // 人數夠了也列（可以佈達），short＝0
    week,
    one('D', '2026-11-07', 0, { category: '道務' }),
    one('E', '2026-11-07', 0, { mode: '公告型', positions: [] }),
    one('F', '2026-11-09', 0, { name: '初一十五打掃（宏宗）' }), // 用總務佈達，不列
    one('G', '2027-08-01', 0) // 一年內都列
  ];
  const r = B.listRows(duties, '2026-11-02', '2027-11-02', '勤務');
  assert.deepEqual(r.map((x) => [x.duty.id, x.short]), [['A', 1], ['B', 0], ['C', 2], ['E', 0], ['W', 3], ['G', 2]]);
  assert.deepEqual(r.find((x) => x.duty.id === 'W').dates, ['2026-11-09', '2026-11-10']);
  assert.deepEqual(B.listRows(duties, '2026-11-02', '2027-11-02', '道務').map((x) => [x.duty.id, x.short]), [['D', 0]]);
});

test('佈達：舊資料沒有類別算總務；期間型勤務從今天算起；總管理者三類都能選，類別帳號固定自己的', () => {
  const week = { id: 'W', name: '12人小組輪值', category: '勤務', mode: '報名型', start: '2026-11-01', end: '2026-11-04', positions: pos, days: {} };
  const r = B.listRows([week, one('X', '2026-11-05', 0, { category: '' })], '2026-11-03', '2026-12-02', '勤務');
  assert.deepEqual(r.map((x) => [x.duty.id, x.date, x.dates.length]), [['W', '2026-11-03', 2], ['X', '2026-11-05', 1]]);
  assert.deepEqual(B.catsFor('總管理者').map((c) => c[1]), ['總務', '道務', '教育']);
  assert.deepEqual(B.catsFor('教育').map((c) => c[1]), ['教育']);
});
