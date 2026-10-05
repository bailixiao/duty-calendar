// 教育的統計（js/edu-stats.js）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/edu-stats.js');

const sess = (date, dutyId, teachers, name = '讀經班') => ({ date, dutyId, name, series: name, teachers, category: '教育' });
const ev = (date, dutyId, here, away, extra) => Object.assign({ date, dutyId, name: '讀經班', series: '讀經班', nature: '課程', category: '教育', tan: [], dao: here, unknown: [], accompany: [], absentNames: away, absent: away.length }, extra);

test('課程：同名合成一個課程，每個日期一堂；學生、出缺勤、平均、出席率', () => {
  const sessions = [sess('2026-10-07', 'D1', '測試甲'), sess('2026-10-14', 'D2', '測試甲、測試乙'), sess('2026-10-21', 'D3', '測試乙'), sess('2026-10-08', 'D9', '測試丙', '書法課')];
  const events = [
    ev('2026-10-07', 'D1', ['王小明', '李小華'], []),
    ev('2026-10-14', 'D2', ['王小明'], ['李小華']),
    ev('2026-10-03', 'D0', ['測試丁'], []), // 期間外
    ev('2026-10-08', 'D9', ['測試戊'], [], { name: '書法課', series: '書法課' })
  ];
  const r = E.summarize(sessions, events, (d) => d >= '2026-10-05' && d <= '2026-10-31');
  assert.deepEqual(r.courses.map((c) => c.name), ['讀經班', '書法課']); // 學生多的在前
  const c = r.courses[0];
  assert.equal(c.sessions.length, 3); // 10/21 沒人報名也算一堂
  assert.equal(c.students.length, 2);
  assert.equal(c.grid['李小華']['D2|2026-10-14'], '✗');
  assert.equal(c.grid['王小明']['D3|2026-10-21'], undefined);
  assert.equal(c.perStudent['王小明'], 2);
  assert.equal(c.perSession['D1|2026-10-07'], 2);
  assert.equal(c.present, 3);
  assert.equal(c.absent, 1);
  assert.equal(c.avg, 1);
  assert.equal(c.rate, 0.75);
  assert.deepEqual(c.teachers, ['測試甲', '測試乙']);
  // 師資：教了哪些課、各幾堂
  const t = r.teachers.find((x) => x.name === '測試甲');
  assert.deepEqual(t, { name: '測試甲', total: 2, byRole: { 師資: 2 }, courses: [{ name: '讀經班', count: 2 }] });
  assert.equal(r.teachers.find((x) => x.name === '測試丙').courses[0].name, '書法課');
  // 複製文字
  const text = E.gridText(c);
  assert.match(text, /^【讀經班】出缺勤表/);
  assert.match(text, /姓名\t10\/7\t10\/14\t10\/21\t出席/);
  assert.match(text, /\t✗\t\t1\/3/);
});

test('學生出席排行：全部課程加總、只看一個課程；出席多的在前，同次數未到少的在前', () => {
  const sessions = [sess('2026-10-07', 'D1', ''), sess('2026-10-14', 'D2', ''), sess('2026-10-08', 'D9', '', '書法課')];
  const events = [
    ev('2026-10-07', 'D1', ['王小明', '李小華'], []),
    ev('2026-10-14', 'D2', ['王小明'], ['李小華']),
    ev('2026-10-08', 'D9', ['李小華', '測試甲'], [], { name: '書法課', series: '書法課' })
  ];
  const r = E.summarize(sessions, events, () => true);
  const all = E.ranking(r.courses, '');
  assert.deepEqual(all.map((x) => [x.name, x.count, x.absent]), [['王小明', 2, 0], ['李小華', 2, 1], ['測試甲', 1, 0]]);
  assert.deepEqual(all[1].byCourse.map((c) => c.name + c.count).sort(), ['書法課1', '讀經班1']);
  assert.deepEqual(E.ranking(r.courses, '書法課').map((x) => x.name), ['李小華', '測試甲']);
});

test('只看幾個課程時，師資也只算那幾個課程', () => {
  const sessions = [sess('2026-10-07', 'D1', '測試甲'), sess('2026-10-08', 'D9', '測試乙', '書法課')];
  const r = E.summarize(sessions, [], () => true);
  assert.deepEqual(E.teachersOf(r.courses.filter((c) => c.name === '書法課')).map((t) => t.name), ['測試乙']);
  assert.equal(E.teachersOf(r.courses).length, 2);
});

test('道務：課程與法會都算；負責人員分講師、帶班、助理帶班', () => {
  const s = (date, dutyId, name, nature, lecturers, leaders, assistants) => ({ date, dutyId, name, series: name, nature, category: '道務', lecturers, leaders, assistants });
  const sessions = [
    s('2026-10-10', 'A1', '初一十五班', '課程', '測試甲', '測試乙', '測試丙'),
    s('2026-10-24', 'A2', '初一十五班', '課程', '', '測試丙', '測試丁'),
    s('2026-11-08', 'B1', '平安齋', '法會', '', '', ''),
    { date: '2026-10-11', dutyId: 'E1', name: '讀經班', series: '讀經班', nature: '課程', category: '教育', teachers: '測試戊' }
  ];
  const events = [ev('2026-10-10', 'A1', ['王小明'], [], { name: '初一十五班', series: '初一十五班', category: '道務' })];
  const r = E.summarize(sessions, events, () => true, '道務');
  assert.deepEqual(r.courses.map((c) => c.name).sort(), ['初一十五班', '平安齋']);
  const c = r.courses.find((x) => x.name === '初一十五班');
  assert.equal(c.sessions.length, 2);
  assert.deepEqual(c.students, ['王小明']);
  const staff = E.teachersOf(r.courses);
  const bing = staff.find((x) => x.name === '測試丙');
  assert.deepEqual([bing.total, bing.byRole], [2, { 助理帶班: 1, 帶班: 1 }]); // 先當助理、後來帶班
  assert.equal(E.summarize(sessions, [], () => true, '教育').courses[0].name, '讀經班'); // 教育不受影響
});
