// 🎤 用講的報名：一句話拆成日期、勤務、項目、名字（2026/11/22）
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/voice-parse.js');

const TODAY = '2026-11-22'; // 星期日
const duty = (id, name, dates, positions) => ({ id, name, mode: '報名型', positions: (positions || ['參加']).map((n, i) => ({ id: id + '-P' + i, name: n })), days: Object.fromEntries(dates.map((d) => [d, {}])) });
const DUTIES = [
  duty('A', '闡道班勤務', ['2026-12-13'], ['維安', '接待', '清潔']),
  duty('B', '闡道班', ['2026-12-13']),
  duty('C', '初一十五打掃（宏宗）', ['2026-12-09', '2026-12-23']),
  duty('D', '初一十五打掃（區中心）', ['2026-12-09', '2026-12-23']),
  duty('E', '外組線參訪彌勒山', ['2026-12-19']),
  { id: 'F', name: '彌勒山志工輪值', mode: '公告型', days: { '2026-12-13': {} } }
];

test('中文數字的日期、各種講法', () => {
  assert.equal(V.normalize('十二月十三號'), '12月13號');
  assert.equal(V.findDate('12月13號', TODAY).date, '2026-12-13');
  assert.equal(V.findDate('12/13', TODAY).date, '2026-12-13');
  assert.equal(V.findDate('明天', TODAY).date, '2026-11-23');
  assert.equal(V.findDate('下禮拜六', TODAY).date, '2026-11-28', '今天星期日（這週最後一天），下禮拜六＝11/28');
  assert.equal(V.findDate('禮拜三', TODAY).date, '2026-11-25', '這週三已經過了，往後找');
  assert.equal(V.findDate('9號', TODAY).date, '2026-12-09', '這個月 9 號過了＝下個月');
  assert.equal(V.findDate('1月3號', '2026-12-20').date, '2027-01-03', '年底講一月＝明年');
});

test('一句話：日期＋勤務＋項目＋名字（語音沒有標點，名字黏在一起）', () => {
  const r = V.parse('我要報名十二月十三號闡道班勤務維安測試甲測試乙', DUTIES, TODAY);
  assert.equal(r.options[0].duty.id, 'A');
  assert.equal(r.options[0].date, '2026-12-13');
  assert.equal(r.position.name, '維安');
  assert.deepEqual(r.nameChunks, ['測試甲測試乙']);
});

test('沒講日期：用勤務名稱找；地點講到了就分得出來；同一個勤務好幾天，最近的排前面', () => {
  const r = V.parse('幫我報名宏宗打掃 測試丙', DUTIES, TODAY);
  assert.equal(r.options[0].duty.id, 'C');
  assert.equal(r.options[0].date, '2026-12-09');
  assert.ok(r.options.some((o) => o.date === '2026-12-23'));
  assert.deepEqual(r.nameChunks, ['測試丙']);
});

test('只講日期：那天可以報名的全部列出來（公告型不算）；講「我」記下來', () => {
  const r = V.parse('我要參加12月13號', DUTIES, TODAY);
  assert.deepEqual(r.options.map((o) => o.duty.id).sort(), ['A', 'B']);
  const r2 = V.parse('我要報名彌勒山參訪', DUTIES, TODAY);
  assert.equal(r2.options[0].duty.id, 'E');
  assert.equal(r2.nameChunks.length, 0);
});

test('黏在一起的名字到名單核對後拆開；中間的「和」可以跳過；名字裡的字不會被拿掉', async () => {
  const names = new Set(['測試甲', '測試乙', '陳正和', '王五']);
  const isName = async (s) => names.has(s);
  assert.deepEqual(await V.splitNames('測試甲測試乙', isName), ['測試甲', '測試乙']);
  assert.deepEqual(await V.splitNames('測試甲和測試乙', isName), ['測試甲', '測試乙']);
  assert.deepEqual(await V.splitNames('陳正和王五', isName), ['陳正和', '王五']);
  assert.deepEqual(await V.splitNames('某某某', isName), ['某某某'], '名單上沒有就照原樣');
});
