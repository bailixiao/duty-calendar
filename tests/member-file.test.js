// 匯入成員資料：Excel／Word／PDF 讀出來的表格，自動找欄位、轉成 items（2026/11/22）
const test = require('node:test');
const assert = require('node:assert');
const MF = require('../js/member-file.js');

test('有表頭：姓名、佛堂、年齡、身分、清口、國外自動對到', () => {
  const rows = [
    ['某某區成員名單'],
    ['編號', '姓名', '所屬佛堂', '年齡', '身份', '清口', '國外'],
    [1, '測試甲', '宏宗', 65, '壇辦', 'V', ''],
    [2, '測試乙（小乙）', '宏宗', '40歲', '道親', '', '大陸'],
    [3, '測試丙', '', '', '新朋友', '是', '韓國'],
    ['', '合計', '', '', '', '', '']
  ];
  const det = MF.detect(rows);
  assert.strictEqual(det.index, 1);
  assert.deepStrictEqual(det.map, { name: 1, temple: 2, age: 3, identity: 4, vegetarian: 5, overseas: 6 });
  const items = MF.toItems(rows, det);
  assert.deepStrictEqual(items, [
    { name: '測試甲', temple: '宏宗', age: 65, identity: '壇辦', vegetarian: true },
    { name: '測試乙', temple: '宏宗', age: 40, identity: '道親', overseas: '陸' },
    { name: '測試丙', identity: '未求道', vegetarian: true, overseas: '韓國' }
  ]);
});

test('出生年：西元、民國、日期、Excel 序號都換成西元年', () => {
  assert.strictEqual(MF.parseBirth('1965', 2026), 1965);
  assert.strictEqual(MF.parseBirth('1965/03/02', 2026), 1965);
  assert.strictEqual(MF.parseBirth('民國54年', 2026), 1965);
  assert.strictEqual(MF.parseBirth('54.03.02', 2026), 1965);
  assert.strictEqual(MF.parseBirth('054/03/02', 2026), 1965);
  assert.strictEqual(MF.parseBirth(new Date(1965, 2, 2), 2026), 1965);
  assert.strictEqual(MF.parseBirth(23803, 2026), 1965); // 1965/3/2 的 Excel 序號
  assert.strictEqual(MF.parseBirth('', 2026), null);
  assert.strictEqual(MF.parseBirth('2099', 2026), null);
  const rows = [['姓名', '出生年月日'], ['測試甲', '54/3/2']];
  assert.deepStrictEqual(MF.toItems(rows, MF.detect(rows), { thisYear: 2026 }), [{ name: '測試甲', birthYear: 1965 }]);
});

test('沒有表頭：看內容猜姓名、身分、年齡', () => {
  const rows = [['測試甲', '壇辦', '65'], ['測試乙', '道親', '40'], ['測試丙', '點傳師', '70']];
  const det = MF.detect(rows);
  assert.strictEqual(det.index, -1);
  assert.deepStrictEqual(det.map, { name: 0, identity: 1, age: 2 });
  assert.strictEqual(MF.toItems(rows, det)[2].identity, '點傳師');
});

test('Word 表格：document.xml 的表格讀成列', () => {
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (...c) => `<w:tr>${c.map(cell).join('')}</w:tr>`;
  const xml = `<w:document><w:body><w:p><w:r><w:t>成員名單</w:t></w:r></w:p><w:tbl>${row('姓名', '佛堂', '身分')}${row('測試甲', '宏宗', '壇辦')}${row('測試乙', '', '道親')}</w:tbl></w:body></w:document>`;
  const tables = MF.docxXmlToTables(xml);
  assert.deepStrictEqual(tables[0], [['姓名', '佛堂', '身分'], ['測試甲', '宏宗', '壇辦'], ['測試乙', '', '道親']]);
  const items = MF.toItems(tables[0], MF.detect(tables[0]));
  assert.deepStrictEqual(items, [{ name: '測試甲', temple: '宏宗', identity: '壇辦' }, { name: '測試乙', identity: '道親' }]);
});

test('PDF：同一高度同一列，空格不會讓後面的欄位跑掉', () => {
  const it = (str, x, y) => ({ str, x, y, w: str.length * 10, h: 10 });
  const rows = MF.pdfItemsToRows([
    it('姓名', 50, 700), it('佛堂', 150, 700), it('身分', 250, 700),
    it('測試甲', 45, 680), it('宏宗', 150, 680), it('壇辦', 250, 681),
    it('測試乙', 45, 660), it('道親', 250, 660) // 佛堂空白
  ]);
  const aligned = MF.alignByHeader(rows, 0);
  assert.deepStrictEqual(aligned[2], ['測試乙', '', '道親']);
  const items = MF.toItems(aligned, MF.detect(aligned));
  assert.deepStrictEqual(items, [{ name: '測試甲', temple: '宏宗', identity: '壇辦' }, { name: '測試乙', identity: '道親' }]);
});

test('貼上從 Excel 複製的表格（tab 分欄）', () => {
  const rows = MF.textToRows('姓名\t年齡\t身分\n測試甲\t65\t壇辦\n測試乙\t\t道親');
  const items = MF.toItems(rows, MF.detect(rows));
  assert.deepStrictEqual(items, [{ name: '測試甲', age: 65, identity: '壇辦' }, { name: '測試乙', identity: '道親' }]);
});

test('PDF 讀成部首字（⾝分、清⼝、測試⼄）也認得', () => {
  const rows = [['姓名', '⾝分', '清⼝'], ['測試⼄', '道親', 'V']];
  assert.deepStrictEqual(MF.toItems(rows, MF.detect(rows)), [{ name: '測試乙', identity: '道親', vegetarian: true }]);
});
