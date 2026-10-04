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

test('國定假日：固定節日、清明、春節除夕、端午中秋（農曆換算由外面給）', () => {
  // 測試用的農曆換算：只給 2027 年用到的幾天
  const table = { '2027-1-1': '2027-02-06', '2028-1-1': '2028-01-26', '2027-5-5': '2027-06-09', '2027-8-15': '2027-09-15' };
  const h = L.holidays(2027, (y, m, d) => table[`${y}-${m}-${d}`]);
  assert.equal(h['2027-01-01'], '元旦');
  assert.equal(h['2027-10-10'], '國慶日');
  assert.equal(h['2027-04-05'], '清明節');
  assert.equal(h['2027-02-05'], '除夕');
  assert.equal(h['2027-02-08'], '春節');
  assert.equal(h['2027-06-09'], '端午節');
  assert.equal(h['2027-09-15'], '中秋節');
  assert.equal(Object.values(h).filter((x) => x === '除夕').length, 1, '2028 年的除夕（2028/1/25）不算在 2027');
  assert.equal(L.holidays(2024)['2024-04-04'], '兒童節、清明節'); // 同一天
});
