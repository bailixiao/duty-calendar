// 批次匯入的解析（js/import-parse.js）。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/import-parse.js');

const groups = [
  { type: '打掃組', name: '第1組' }, { type: '勤務了愿組', name: '第1組' },
  { type: '打掃組', name: '青年組' }, { type: '拜香輪值組', name: '第五組（青年組）' }
];

test('日期：民國年、西元年、多天區間、跨年省略年份', () => {
  assert.deepEqual(P.parseDates('115/10/18'), { start: '2026-10-18', end: '2026-10-18' });
  assert.deepEqual(P.parseDates('2026-10-18'), { start: '2026-10-18', end: '2026-10-18' });
  assert.deepEqual(P.parseDates('115/11/8-115/11/15'), { start: '2026-11-08', end: '2026-11-15' });
  assert.deepEqual(P.parseDates('115/11/8~11/15'), { start: '2026-11-08', end: '2026-11-15' });
  assert.deepEqual(P.parseDates('115/12/30～1/2'), { start: '2026-12-30', end: '2027-01-02' });
  assert.deepEqual(P.parseDates('2026-11-08 ~ 2026-11-10'), { start: '2026-11-08', end: '2026-11-10' });
  assert.match(P.parseDates('115/2/30').error, /看不懂日期/);
  assert.match(P.parseDates('10/18').error, /看不懂日期/);
  assert.match(P.parseDates('115/11/8-115/11/1').error, /結束日早於開始日/);
});

test('時段', () => {
  assert.deepEqual(P.parseTimes('8:00-12:00'), { startTime: '08:00', endTime: '12:00' });
  assert.deepEqual(P.parseTimes('21:00 – 08:00'), { startTime: '21:00', endTime: '08:00' });
  assert.deepEqual(P.parseTimes('14:00'), { startTime: '14:00', endTime: '' });
  assert.deepEqual(P.parseTimes(''), { startTime: '', endTime: '' });
  assert.match(P.parseTimes('早上').error, /看不懂時段/);
});

test('負責組：分組類型＋組名；組名唯一時可省略類型；重複或不存在時報錯', () => {
  assert.deepEqual(P.parseGroup('打掃組 第1組', groups), { groupType: '打掃組', group: '第1組' });
  assert.deepEqual(P.parseGroup('勤務了愿組／第1組', groups), { groupType: '勤務了愿組', group: '第1組' });
  assert.deepEqual(P.parseGroup('青年組', groups), { groupType: '打掃組', group: '青年組' });
  assert.match(P.parseGroup('第1組', groups).error, /好幾種分組都有/);
  assert.match(P.parseGroup('打掃組 第9組', groups).error, /沒有「第9組」/);
  assert.deepEqual(P.parseGroup('', groups), { groupType: '', group: '' });
});

test('了愿項目：N＝最少最多都是 N；A-B；N+；只寫名稱＝不限', () => {
  assert.deepEqual(P.parsePositions('烹飪 4、清潔 2-4、志工 2+、打掃').positions, [
    { name: '烹飪', slot: '', min: '4', max: '4' },
    { name: '清潔', slot: '', min: '2', max: '4' },
    { name: '志工', slot: '', min: '2', max: '' },
    { name: '打掃', slot: '', min: '', max: '' }
  ]);
  assert.deepEqual(P.parsePositions('交通2人，茶水 2').positions.map((p) => [p.name, p.max]), [['交通', '2'], ['茶水', '2']]);
});

test('整段解析：略過標題列與空白列，逐列回報錯誤', () => {
  const text = [
    '日期\t名稱\t時段\t地點\t負責組\t了愿項目',
    '115/12/5\t宏宗打蠟\t8:00\t宏宗\t打掃組 第1組\t打蠟',
    '',
    '115/12/6\t\t\t\t\t志工 2',
    '115/12/7\t拜香\t\t\t拜香輪值組 第五組（青年組）\t\t公告型',
    '115/12/8\t沒寫項目'
  ].join('\n');
  const rows = P.parse(text, groups);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].line, 2);
  assert.deepEqual(rows[0].duty, {
    name: '宏宗打蠟', nature: '勤務', mode: '報名型', start: '2026-12-05', end: '2026-12-05',
    startTime: '08:00', endTime: '', location: '宏宗', groupType: '打掃組', group: '第1組',
    attire: '', description: '', positions: [{ name: '打蠟', slot: '', min: '', max: '' }]
  });
  assert.deepEqual(rows[1].errors, ['沒有名稱']);
  assert.equal(rows[1].duty, null);
  assert.deepEqual(rows[2].errors, []);
  assert.deepEqual(rows[2].duty.positions, []);
  assert.match(rows[3].errors.join(), /報名型要寫了愿項目/);
});
