// 總務佈達（js/admin-notice.js）。執行：node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../js/format.js');
global.Fmt = global.window.Fmt;
const N = require('../js/admin-notice.js');

const clean = (place, group, leader) => ({ name: `初一十五打掃（${place}）`, start: '2026-11-09', end: '2026-11-09', groupType: '打掃組', group, groupLeader: leader });

test('總務佈達：打掃輪值依地點排好、組別寫中文、召集人；拜香輪值寫組長', () => {
  const duties = [
    clean('彌勒山母殿', '第3組', '測試丙'),
    clean('宏宗', '第2組', '測試甲'),
    clean('區中心', '青年組', '測試乙'),
    { name: '十月初一拜香輪值', start: '2026-11-09', end: '2026-11-09', groupType: '拜香輪值組', group: '第三組', groupLeader: '測試丁' },
    { name: '12人小組輪值', start: '2026-11-08', end: '2026-11-15', groupType: '', group: '' }
  ];
  const t = N.text('2026-11-09', duties, { full: '十月初一' });
  assert.equal(t, [
    '總務佈達🎉🎉🎉', '農曆十月初一', '（國曆11月9日星期一）',
    '🧹佛堂打掃-打掃輪值',
    '(⭐️)宏宗 第二組', '召集人：測試甲',
    '(⭐️)區中心 青年組', '召集人：測試乙',
    '(⭐️)母殿 第三組', '召集人：測試丙',
    '🛐拜香輪值', '第三組 組長：測試丁'
  ].join('\n'));
  assert.deepEqual(N.datesOf(duties, '2026-10-26'), ['2026-11-09']);
  assert.equal(N.zhGroup('第10組'), '第十組');
});
