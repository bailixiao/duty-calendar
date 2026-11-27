// 前處理：程式先挑本區的行、月曆直接讀（js/region-lines.js）。執行：node --test
// 測試用的表都是假的；名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const RL = require('../js/region-lines.js');

const ROSTER = [
  '115年度測試輪值表',
  '日期 工作 區別 備註',
  '04/12~04/19 香積 真善 第一組',
  '05/03 環保 美志',
  '05/17 打掃 孝仁',
  '06/14 煮飯 勇定',
  '(週日) 慧發',
  '07/12 煮飯 慈捨',
  '08/15 法會支援 慈理捨全真 要 6 人',
  '09/20 香積 真善',
  '10/18 環保 美志',
  '11/08 打掃 孝仁',
  '12/06 煮飯 勇定',
  '12/20 法會 慧發'
];

test('分得出本區：全名、簡寫都算，一般的詞（安全、全部）不算', () => {
  assert.equal(RL.shortOf('教全區'), '全');
  assert.equal(RL.hasRegion('慈理捨全真', '教全區'), true);
  assert.equal(RL.hasRegion('( 全 )', '教全區'), true);
  assert.equal(RL.hasRegion('教全區負責', '教全區'), true);
  assert.equal(RL.hasRegion('注意安全，全部帶齊', '教全區'), false);
  assert.equal(RL.hasRegion('一定要準時', '教定區'), false);
  assert.equal(RL.hasRegion('勇定', '教定區'), true);
});

test('很多區的表：只留表頭和本區那幾行（前 3 後 2）；沒有本區就跳過；一般的頁整頁', () => {
  const r = RL.pick(ROSTER, '教全區');
  assert.equal(r.kind, 'part');
  assert.deepEqual(r.lines, ROSTER.slice(0, 2).concat(ROSTER.slice(5, 11)));
  assert.ok(r.lines.some((l) => /08\/15/.test(l)));
  // 同一張表，沒有全的版本 → 跳過
  const noMine = ROSTER.map((l) => l.replace('慈理捨全真', '慈理捨真'));
  assert.equal(RL.pick(noMine, '教全區').kind, 'skip');
  // 一般通知（看不出很多區）→ 整頁
  const notice = ['中秋聯誼通知', '時間：9/25 晚上 7 點', '地點：區中心', '請大家注意安全', '歡迎全家一起來'];
  assert.deepEqual(RL.pick(notice, '教全區'), { kind: 'all', lines: notice });
  // 區名不是「教X區」（例：宏教分壇）→ 整頁
  assert.equal(RL.pick(ROSTER, '宏教分壇').kind, 'all');
});

test('月曆：每一格「幾號 區別」程式直接讀，月份看前面的「X 月份」；不是月曆回傳 null', () => {
  const cal = [
    '測試輪值月曆',
    '115年1月份',
    '週日 週一 週二 週三 週四 週五 週六',
    '1真全 2休息日 3捨慈',
    '4發慧 5休息日 6定勇 7休息日 8仁孝 9休息日 10志美',
    '11善真 12休息日 13慈發 14休息日 15全捨 16休息日 17慧定',
    '115年2月份',
    '週日 週一 週二 週三 週四 週五 週六',
    '1 志美 2 休息日 3 善真 4 休息日 5 慈發 6 休息日 7 全捨'
  ];
  assert.deepEqual(RL.calendar(cal, '教全區', 2026), [
    { date: '2026-01-01', text: '真全' }, { date: '2026-01-15', text: '全捨' }, { date: '2026-02-07', text: '全捨' }
  ]);
  assert.equal(RL.calendar(ROSTER, '教全區', 2026), null);
  // 是月曆、但格子裡沒有本區 → 照舊給 AI
  assert.equal(RL.calendar(cal.map((l) => l.replace(/全/g, '')), '教全區', 2026), null);
});

test('區的清單和 js/region.js 一樣（教全區＋12 區，不含宏教分壇）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'region.js'), 'utf8');
  const names = [...src.match(/const REGIONS = \{([\s\S]*?)\};/)[1].matchAll(/'(教.區)'/g)].map((m) => m[1]);
  assert.equal(names.length, 12);
  assert.deepEqual(RL.NAMES.slice().sort(), ['教全區'].concat(names).sort());
});
