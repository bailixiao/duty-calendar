// 從檔案帶入舊資料：表格直接讀（js/old-parse.js）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/old-parse.js');

test('日期、時間、人名的各種寫法', () => {
  assert.equal(P.oneDate('2025/3/7'), '2025-03-07');
  assert.equal(P.oneDate('114/3/7'), '2025-03-07');
  assert.equal(P.oneDate('114.03.07'), '2025-03-07');
  assert.equal(P.oneDate('114年3月7日(五)'), '2025-03-07');
  assert.equal(P.oneDate('3/7', 2024), '2024-03-07');
  assert.equal(P.oneDate('3/7'), '', '沒有年份不猜');
  assert.equal(P.oneDate(45723), '2025-03-07');
  assert.equal(P.oneDate(new Date(2025, 2, 7)), '2025-03-07');
  assert.equal(P.oneDate('2025/2/30'), '');
  assert.deepEqual(P.dateRange('8/24~8/31', 2025), { start: '2025-08-24', end: '2025-08-31' });
  assert.deepEqual(P.dateRange('12/30~1/2', 2025), { start: '2025-12-30', end: '2026-01-02' });
  assert.deepEqual(P.dateRange('114/3/7', 0), { start: '2025-03-07', end: '' });
  assert.deepEqual(P.timeRange('8:00～12:00'), { start: '08:00', end: '12:00' });
  assert.deepEqual(P.timeRange('0800-1200'), { start: '08:00', end: '12:00' });
  assert.deepEqual(P.peopleOf('測試甲、測試乙,測試丙\n1.測試丁（小丁） 測試戊等'), ['測試甲', '測試乙', '測試丙', '測試丁', '測試戊']);
  assert.equal(P.yearOf('教全區勤務統計114年.xlsx'), 2025);
  assert.equal(P.yearOf('2024 出勤'), 2024);
});

test('一般表格：表頭、一列一場、身分欄、合計跳過', () => {
  const rows = [
    ['教全區 114 年活動紀錄'],
    ['日期', '活動名稱', '時間', '地點', '壇辦', '道親', '備註'],
    ['114/3/7', '宏宗打掃', '8:00-12:00', '宏宗', '測試甲', '測試乙、測試丙', '測試丁'],
    ['3/8', '中秋聯誼', '', '', '', '測試乙', ''],
    ['', '', '', '', '', '測試戊', ''],
    ['3/9', '', '', '', '測試甲', '', ''],
    ['合計', '', '', '', '2', '4', '']
  ];
  const r = P.parseTable(rows, { label: '活動.xlsx' });
  assert.equal(r.header, true);
  assert.deepEqual(r.sessions.map((s) => [s.date, s.name, s.people.map((p) => p.name + (p.identity ? '/' + p.identity : '')).join('、')]), [
    ['2025-03-07', '宏宗打掃', '測試甲/壇辦、測試乙/道親、測試丙/道親'],
    ['2025-03-08', '中秋聯誼', '測試乙/道親、測試戊/道親'],
    ['2025-03-09', '中秋聯誼', '測試甲/壇辦']
  ]);
  assert.deepEqual([r.sessions[0].startTime, r.sessions[0].endTime, r.sessions[0].location], ['08:00', '12:00', '宏宗']);
  assert.equal(r.sessions[0].byTable, true);
});

test('找不到表頭就交給 AI；日期看不懂標出來；同一場合併', () => {
  assert.equal(P.parseTable([['測試甲', '測試乙'], ['3月份']]).header, false);
  const r = P.parseTable([['日期', '項目', '出席人員'], ['某天', '打掃', '測試甲']], {});
  assert.match(r.sessions[0].uncertain[0], /日期看不懂/);
  const m = P.mergeSame([
    { name: '打掃', date: '2025-03-07', category: '', people: [{ name: '測試甲' }], uncertain: [], byTable: true },
    { name: '打 掃', date: '2025-03-07', category: '', people: [{ name: '測試甲' }, { name: '測試乙' }], uncertain: ['x'], byTable: false, location: '宏宗' }
  ]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].people.map((p) => p.name), ['測試甲', '測試乙']);
  assert.equal(m[0].location, '宏宗');
  assert.equal(m[0].byTable, false);
});
