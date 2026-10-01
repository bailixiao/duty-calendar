// 匯入歷史資料的解析（js/history-parse.js）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/history-parse.js');

// 新格式（有「活動項目-1」「日期-1」輔助欄）
const monthNew = [
  ['', '', '', '', '', '', 3, '', 3],
  ['2026/9月教全區勤務統計分析表', '', '', '', '', '', '', '', '', '', '備註'],
  ['活動項目', '活動項目-1', '日期-1', '日期', '性質', '壇辦姓名', '人數', '道親姓名', '人數', '道親%', ''],
  ['宏宗打掃', '宏宗打掃', 46270, 46270, '勤務', '測試甲', 2, '測試乙', 2, 0.5, '測試丙、測試丁'],
  ['', '宏宗打掃', 46270, '', '勤務', '測試戊 ', '', ' 測試己', '', '', ''],
  ['一日志工', '一日志工', 46287, 46287, '支援', '', 0, '測試庚', 1, 1, ''],
  ['一日志工', '一日志工', 46287, '', '支援', '', 0, '測試辛', 0, 0, ''], // 每列重複寫活動項目：同一場
  ['一日志工', '一日志工', 46288, 46288, '支援', '', 0, '測試壬', 1, 1, ''], // 同名不同日：另一場
  ['', '', '', '', '', '', '', '', '', '', '\n\n\n']
];

// 舊格式（沒有輔助欄，備註在標題列）
const monthOld = [
  ['', '', '', '', 1, '', 1],
  ['2025/12月教全區勤務統計分析表', '', '', '', '', '', '', '', '備註'],
  ['活動項目', '日期', '性質', '壇辦姓名', '人數', '道親姓名', '人數', '道親%', ''],
  ['參訪', 46006, '勤務', '測試甲', 1, '測試乙', 1, 0.5, '']
];

test('日期：Excel 序號與文字', () => {
  assert.equal(H.toDate(46266), '2026-09-01');
  assert.equal(H.toDate('46266'), '2026-09-01');
  assert.equal(H.toDate('2026/9/5'), '2026-09-05');
  assert.equal(H.toDate('115/9/5'), '2026-09-05');
  assert.equal(H.toDate('九月'), '');
  assert.deepEqual(H.toDateRange('8/24~8/31', 2025), { start: '2025-08-24', end: '2025-08-31' });
  assert.deepEqual(H.toDateRange('12/30-1/2', 2025), { start: '2025-12-30', end: '2026-01-02' });
  assert.deepEqual(H.toDateRange('8/24', 2025), { start: '2025-08-24', end: '2025-08-24' });
  assert.equal(H.toDateRange('8/24', 0), null);
});

test('解析每月分頁：依標題找欄位、同一場的多列合併、名字去空白、備註當陪同', () => {
  const r = H.parseMonth(monthNew);
  assert.deepEqual(r.problems, []);
  assert.equal(r.events.length, 3);
  assert.deepEqual(r.events[0], { date: '2026-09-05', end: '2026-09-05', name: '宏宗打掃', nature: '勤務', tan: ['測試甲', '測試戊'], dao: ['測試乙', '測試己'], accompany: ['測試丙', '測試丁'], row: 4 });
  assert.deepEqual(r.events[1].dao, ['測試庚', '測試辛']);
  assert.equal(r.events[2].date, '2026-09-23');
  assert.equal(r.events[1].nature, '支援');

  const old = H.parseMonth(monthOld);
  assert.deepEqual(old.events.map((e) => [e.date, e.name, e.tan, e.dao]), [['2025-12-15', '參訪', ['測試甲'], ['測試乙']]]);
  assert.match(H.parseMonth([['沒有標題']]).problems[0], /找不到標題列/);
});

test('整本：各月人數與「統計」分頁核對', () => {
  const wb = H.parseWorkbook({
    '統計': [['', '月份', '壇辦人數'], ['9月', 3, 3, 0.5], ['12月', 1, 1]],
    '9月': monthNew,
    '12月': monthOld,
    '說明': [['不是月份']]
  });
  assert.deepEqual(wb.months.map((m) => [m.month, m.tan, m.dao, m.expected]), [
    [9, 2, 5, { tan: 3, dao: 3 }],
    [12, 1, 1, { tan: 1, dao: 1 }]
  ]);
});

test('疑似同一人：異體字、簡稱包含在全名裡；不同全名不串在一起', () => {
  const groups = H.similarGroups(['測試藴', '測試蘊', '測試蘊', '小明', '王小明', '測試甲', '甲乙', '陳甲乙', '李甲乙', '王甲乙']);
  const names = groups.map((g) => g.names.map((n) => n.name));
  assert.deepEqual(names.find((g) => g.includes('測試蘊')), ['測試蘊', '測試藴'], '次數多的排前面');
  assert.ok(names.some((g) => g.includes('小明') && g.includes('王小明')));
  assert.ok(!names.some((g) => g.includes('測試甲')));
  // 建議：只有一個全名才合併；簡稱對到好幾個全名就各自保留；不同全名不會因為名字相同串在一起
  assert.equal(groups.find((g) => g.names.some((n) => n.name === '小明')).suggest, '王小明');
  assert.equal(groups.find((g) => g.names.some((n) => n.name === '測試蘊')).suggest, '測試蘊');
  const mei = groups.find((g) => g.names.some((n) => n.name === '甲乙'));
  assert.equal(mei.suggest, '');
  assert.equal(H.similarGroups(['陳甲乙', '李甲乙']).length, 0);
});

test('備註：只收 2–4 個字的姓名，其他列為問題', () => {
  const rows = [
    ['活動項目', '日期', '性質', '壇辦姓名', '人數', '道親姓名', '人數', '道親%', '備註'],
    ['參訪', 46006, '勤務', '測試甲', 1, '', 0, 0, '測試乙、甲、支援烹飪組協助']
  ];
  const r = H.parseMonth(rows, 2025);
  assert.deepEqual(r.events[0].accompany, ['測試乙']);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /第 2 列備註「甲」不像姓名/);
});
