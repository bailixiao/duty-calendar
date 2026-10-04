// 職司表（js/roster-grid.js）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/roster-grid.js');

const STAGES = '即日起~9/13｜向區中心報名了愿日期\n9/14~9/18｜職司初安排\n9/21(一)｜線上確認職司\n9/27~10/4｜小組輪值';

test('階段：日期解析、現在進行中的階段', () => {
  const s = G.parseStages(STAGES, '2026-09-27', '2026-09-15');
  assert.deepEqual(s.map((x) => [x.from, x.to]), [[null, '2026-09-13'], ['2026-09-14', '2026-09-18'], ['2026-09-21', '2026-09-21'], ['2026-09-27', '2026-10-04']]);
  assert.deepEqual(s.map((x) => x.state), ['done', 'now', 'todo', 'todo']);
  assert.equal(s[0].when, '即日起~9/13');
  assert.equal(s[0].text, '向區中心報名了愿日期');
  // 兩個階段中間的空檔：亮下一個
  assert.deepEqual(G.parseStages(STAGES, '2026-09-27', '2026-09-19').map((x) => x.state), ['done', 'done', 'now', 'todo']);
  assert.equal(G.parseStages(STAGES, '2026-09-27', '2026-10-04')[3].state, 'now');
  // 跨年：一月的勤務，十二月的階段算前一年
  assert.equal(G.parseStages('12/20~12/31｜報名', '2027-01-05', '2026-12-25')[0].from, '2026-12-20');
  // 沒寫日期的行也照樣顯示
  assert.deepEqual(G.parseStages('記得帶環保餐具', '2026-09-27', '2026-09-15').map((x) => [x.when, x.text, x.state]), [['', '記得帶環保餐具', 'todo']]);
});

test('職司表：一欄一天，組長排第一個，列數＝人最多的那天；人數不含陪同', () => {
  const duty = {
    start: '2026-09-27', end: '2026-09-28', today: '2026-09-28',
    positions: [{ id: 'P1', name: '烹飪' }, { id: 'P2', name: '維安' }],
    signups: [
      { id: 'a', date: '2026-09-27', positionId: 'P1', name: '測試甲' },
      { id: 'b', date: '2026-09-27', positionId: 'P1', name: '測試乙', leader: true },
      { id: 'c', date: '2026-09-27', positionId: 'P1', name: '測試丙', accompany: true },
      { id: 'd', date: '2026-09-28', positionId: 'P2', name: '測試丁' }
    ]
  };
  const g = G.build(duty);
  assert.deepEqual(g.dates, [{ date: '2026-09-27', total: 2, today: false }, { date: '2026-09-28', total: 1, today: true }]);
  assert.deepEqual(g.groups.map((x) => x.rows), [3, 1]);
  assert.deepEqual(g.groups[0].cells['2026-09-27'].map((s) => s.name), ['測試乙', '測試甲', '測試丙']);
  assert.deepEqual(g.groups[0].cells['2026-09-28'], []);
});

test('階段自動推算：輪值前的禮拜一調整、前一週一到五安排、再往前兩週報名', () => {
  assert.equal(G.autoStages('2026-11-08'), '10/12~10/25｜報名了愿日期\n10/26~10/30｜職司安排\n11/2(一)｜壇辦班職司最後調整');
  // 範例那次（9/27 開始）推回去和範例的調整日相同
  assert.match(G.autoStages('2026-09-27'), /9\/21\(一\)｜壇辦班職司最後調整$/);
  // 第一天就是禮拜一：調整日是前一個禮拜一
  assert.match(G.autoStages('2026-11-09'), /11\/2\(一\)/);
  // 跨年
  assert.equal(G.autoStages('2027-01-10').split('\n')[0], '12/14~12/27｜報名了愿日期');
  assert.equal(G.stagesText({ stages: '  ', start: '2026-11-08' }).split('\n').length, 3);
  assert.equal(G.stagesText({ stages: '自己寫的', start: '2026-11-08' }), '自己寫的');
});
