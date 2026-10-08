// 各佛堂道務目標的總計（js/admin-goals.js）。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
global.Fmt = { esc: (s) => String(s) };
const G = require('../js/admin-goals.js');

test('總計與達成率：渡人合併只算一次；合併的格子跨幾列', () => {
  const rows = [
    { name: '甲', values: { 渡人: { target: '5', current: '5' }, 明道班: { target: '3', current: '1' } }, group: '' },
    { name: '乙', values: { 渡人: { target: '21', current: '6' } }, group: '海外' },
    { name: '丙', values: { 渡人: { target: '99', current: '99' } }, group: '海外' } // 合併的第二列：不算
  ];
  const t = G.totals(rows, ['渡人', '明道班', '安壇']);
  assert.deepEqual(t.渡人, { target: 26, current: 11, rate: 11 / 26 });
  assert.deepEqual(t.明道班, { target: 3, current: 1, rate: 1 / 3 });
  assert.deepEqual(t.安壇, { target: null, current: 0, rate: null });
  assert.deepEqual(G.groupSpans(rows), [1, 2, 0]);
});

test('各佛堂的成員人數：壇辦、清口、道親、未求道；不算停用、待確認、別的佛堂', () => {
  const c = G.memberCounts([
    { identity: '壇辦', temple: '測試堂', active: true },
    { identity: '道親', temple: '測試堂', active: true, vegetarian: true },
    { identity: '道親', temple: '測試堂', active: true },
    { identity: '未求道', temple: '測試堂', active: true },
    { identity: '道親', temple: '測試堂', active: false },
    { identity: '道親', temple: '測試堂', active: true, pending: true },
    { identity: '壇辦', temple: '別堂', active: true }
  ], '測試堂');
  assert.deepEqual(c, { 壇辦: 1, 清口: 1, 道親: 2, 未求道: 1 });
});

test('國外的人算在國外那張卡片，不算原本的佛堂', () => {
  const ms = [{ identity: '道親', temple: '測試堂', overseas: '陸', active: true, vegetarian: true }, { identity: '道親', temple: '測試堂', active: true }];
  assert.deepEqual(G.memberCounts(ms, '測試堂'), { 壇辦: 0, 清口: 0, 道親: 1, 未求道: 0 });
  assert.deepEqual(G.memberCounts(ms, '陸'), { 壇辦: 0, 清口: 1, 道親: 1, 未求道: 0 });
});
