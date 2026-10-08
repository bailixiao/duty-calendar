// 網站設定：前端 js/site.js 與後端 apps-script/Config.gs 的 SITE，共同欄位要一致（複製給別的團體時兩邊都要改）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./env');

test('網站設定：前端和後端的團體名稱、場地、用詞、類別名稱、地點選項一致', () => {
  const window = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'js', 'site.js'), 'utf8'))(window);
  const front = window.SITE;
  const back = createEnv(Date.UTC(2026, 9, 7, 2)).fn('SITE');
  ['name', 'org', 'venue', 'temple', 'categoryLabels', 'locations'].forEach((k) => {
    assert.deepEqual(front[k], back[k], 'SITE.' + k + ' 兩邊不一樣');
  });
  assert.ok(front.features && front.examples && front.eduTeacherClasses, '前端設定欄位齊全');
});

test('圖解教學：每一步都有圖片檔', () => {
  const fs = require('fs');
  const path = require('path');
  const T = require('../js/tutorial.js');
  Object.keys(T.STEPS).forEach((n) => {
    const files = T.DIFF.indexOf(n) !== -1 ? [`ios-${n}.jpg`, `android-${n}.jpg`] : [`${n}.jpg`];
    files.forEach((f) => assert.ok(fs.existsSync(path.join(__dirname, '..', 'img', 'tutorial', f)), '少了 ' + f));
  });
});
