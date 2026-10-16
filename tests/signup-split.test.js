// 報名填名字：一格好幾個名字的拆法（js/signup.js splitInput）。執行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
global.Fmt = {};
require('../js/signup.js');
const { splitInput } = global.window.SignupForm;

test('名單編號拿掉只留名字', () => {
  assert.deepEqual(splitInput('1.測試甲 2.測試乙'), ['測試甲', '測試乙']);
  assert.deepEqual(splitInput('1.測試甲'), ['測試甲']);
  assert.deepEqual(splitInput('1、測試甲 2、測試乙'), ['測試甲', '測試乙']);
  assert.deepEqual(splitInput('(1)測試甲(2)測試乙'), ['測試甲', '測試乙']);
  assert.deepEqual(splitInput('①測試甲②測試乙'), ['測試甲', '測試乙']);
  assert.deepEqual(splitInput('1) 測試甲\n2) 測試乙\n3) 王小明'), ['測試甲', '測試乙', '王小明']);
  assert.deepEqual(splitInput('１．測試甲　２．測試乙'), ['測試甲', '測試乙'], '全形數字');
  assert.deepEqual(splitInput('測試甲1'), ['測試甲']);
});

test('原本的拆法不變', () => {
  assert.deepEqual(splitInput('王小明.測試甲'), ['王小明', '測試甲']);
  assert.deepEqual(splitInput('王小明 測試甲'), ['王小明', '測試甲']);
  assert.deepEqual(splitInput('王小明'), ['王小明']);
  assert.deepEqual(splitInput('Amy Lin'), ['Amy Lin']);
});
