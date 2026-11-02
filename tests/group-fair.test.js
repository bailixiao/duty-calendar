// 建議負責組（js/group-fair.js）。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../js/format.js');
global.Fmt = global.window.Fmt;
const G = require('../js/group-fair.js');

const d = (id, group, start, type) => ({ id, group, start, end: start, groupType: type || '勤務了愿組' });

test('建議負責組：負責最少的排前面，一樣多就看誰比較久沒輪到', () => {
  const duties = [
    d('a', '第1組', '2026-03-01'), d('b', '第1組', '2026-12-01'),
    d('c', '第2組', '2026-09-01'),
    d('e', '第3組', '2026-05-01'),
    d('f', '第4組', '2025-01-01'), // 超過一年，不算
    d('g', '第4組', '2026-06-01', '打掃組') // 別的分組類型，不算
  ];
  const r = G.rank(['第1組', '第2組', '第3組', '第4組'], '勤務了愿組', duties, '2026-11-20', '', '2026-11-02');
  assert.deepEqual(r.map((x) => x.name), ['第4組', '第3組', '第2組', '第1組']);
  assert.deepEqual(r[0], { name: '第4組', count: 0, last: '', busy: false });
  assert.deepEqual(r[3], { name: '第1組', count: 2, last: '2026-12-01', busy: false });
});

test('建議負責組：當天已有勤務的組排最後；編輯中的這筆不算', () => {
  const duties = [d('x', '第1組', '2026-11-20'), d('y', '第2組', '2026-10-01'), d('self', '第3組', '2026-11-20')];
  const r = G.rank(['第1組', '第2組', '第3組'], '勤務了愿組', duties, '2026-11-20', 'self', '2026-11-02');
  assert.deepEqual(r.map((x) => [x.name, x.busy]), [['第3組', false], ['第2組', false], ['第1組', true]]);
});
