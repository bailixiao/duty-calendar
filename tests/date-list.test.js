// 「多個日期」（js/date-list.js）。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/date-list.js');

test('每週固定星期幾', () => {
  assert.deepEqual(L.weekly('2027-01-01', '2027-01-31', [3]), ['2027-01-06', '2027-01-13', '2027-01-20', '2027-01-27']);
  assert.deepEqual(L.weekly('2027-01-01', '2027-01-10', [0, 6]), ['2027-01-02', '2027-01-03', '2027-01-09', '2027-01-10']);
  assert.deepEqual(L.weekly('2027-01-10', '2027-01-01', [3]), []);
  assert.deepEqual(L.weekly('2027-01-01', '2027-01-31', []), []);
});

test('貼上日期清單：各種寫法、去重排序、看不懂的列出來', () => {
  const r = L.parse('1/7（四）、1/14\n2月4日, 2027/3/1 2027-03-08；116/4/5 1/7 13/40 abc', 2027);
  assert.deepEqual(r.dates, ['2027-01-07', '2027-01-14', '2027-02-04', '2027-03-01', '2027-03-08', '2027-04-05']);
  assert.deepEqual(r.bad, ['13/40', 'abc']);
  assert.deepEqual(L.parse('2/29', 2027).bad, ['2/29']); // 不存在的日期
  assert.deepEqual(L.parse('星期三 3/3', 2027).dates, ['2027-03-03']);
});
