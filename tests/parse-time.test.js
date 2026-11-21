// 打字填時間（2026/11/21）：0830、930、8:30、下午9點半⋯都換成 HH:MM。執行：在專案根目錄執行 node --test
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global.window || {};
require('../js/format.js');
const { parseTime } = global.window.Fmt;

test('打字的時間換成 HH:MM', () => {
  const ok = { '0830': '08:30', '830': '08:30', '8:30': '08:30', '8.30': '08:30', '８：３０': '08:30', '2145': '21:45', '21:45': '21:45',
    '9': '09:00', '21': '21:00', '8點': '08:00', '8點半': '08:30', '8點15分': '08:15', '下午9:45': '21:45', '晚上9點半': '21:30',
    '上午12:00': '00:00', '中午12點': '12:00', '9:45pm': '21:45', '00:00': '00:00', ' 0700 ': '07:00' };
  for (const [k, v] of Object.entries(ok)) assert.equal(parseTime(k), v, k);
  assert.equal(parseTime(''), '');
  for (const bad of ['2560', '24:00', '8:75', 'abc', '12345']) assert.equal(parseTime(bad), null, bad);
});
