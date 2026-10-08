// 統計的計算（js/stats-calc.js）。執行：在專案根目錄執行 node --test
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/stats-calc.js');

const ev = (date, tan, dao, extra) => Object.assign({ date, dutyId: 'D' + date, name: '測試勤務', series: '測試勤務', nature: '勤務', tan, dao, unknown: [], accompany: [], absent: 0, short: 0 }, extra);

const events = [
  ev('2025-10-05', ['測試甲'], ['測試乙']),
  ev('2026-08-10', ['測試甲'], []),
  ev('2026-09-10', ['測試甲'], ['測試乙', '測試丙']),
  ev('2026-10-10', ['測試甲', '測試丁'], ['測試乙', '測試丙', '測試戊'], { series: '打掃', short: 1 }),
  ev('2026-10-24', [], ['測試乙'], { unknown: ['測試己'], accompany: ['測試庚'] })
];

test('期間：月、季、年的換算、往前移與跨年', () => {
  assert.deepEqual(S.periodOf('quarter', '2026-10-10'), { unit: 'quarter', year: 2026, n: 4 });
  assert.deepEqual(S.shift({ unit: 'month', year: 2026, n: 1 }, -1), { unit: 'month', year: 2025, n: 12 });
  assert.deepEqual(S.shift({ unit: 'quarter', year: 2026, n: 1 }, -2), { unit: 'quarter', year: 2025, n: 3 });
  assert.deepEqual(S.shift({ unit: 'year', year: 2026, n: 0 }, -1), { unit: 'year', year: 2025, n: 0 });
  assert.equal(S.label({ unit: 'month', year: 2026, n: 10 }), '115 年 10 月');
  assert.equal(S.label({ unit: 'quarter', year: 2026, n: 4 }), '115 年第 4 季（10–12 月）');
});

test('彙總：人次、不重複人數、佔比（含未填身分）、缺人場次；沒資料時佔比是 null', () => {
  const oct = S.summarize(events, { unit: 'month', year: 2026, n: 10 });
  assert.deepEqual(
    [oct.events, oct.tan, oct.dao, oct.unknown, oct.total, oct.people, oct.accompany, oct.shortEvents],
    [2, 2, 4, 1, 7, 6, 1, 1]
  );
  assert.equal(oct.ratio, 4 / 7);
  const empty = S.summarize(events, { unit: 'month', year: 2026, n: 1 });
  assert.equal(empty.ratio, null);
  assert.equal(empty.hasData, false);
  assert.equal(S.pct(empty.ratio), '—');
});

test('比較與趨勢：上一期、去年同期、最近幾期', () => {
  const p = { unit: 'month', year: 2026, n: 10 };
  const now = S.summarize(events, p);
  const prev = S.summarize(events, S.shift(p, -1));
  const ly = S.summarize(events, S.lastYear(p));
  assert.deepEqual(S.delta(now.total, prev.total), { text: '+4', sign: 1 });
  assert.deepEqual(S.delta(now.total, ly.total), { text: '+5', sign: 1 });
  assert.deepEqual(S.delta(3, 3), { text: '持平', sign: 0 });
  assert.deepEqual(S.delta(0.5, 0.75, true), { text: '−25%', sign: -1 });
  assert.deepEqual(S.delta(0.5, null, true), { text: null, sign: 0 });
  const t = S.trend(events, p, 3);
  assert.deepEqual(t.map((x) => [x.period.n, x.total]), [[8, 1], [9, 3], [10, 7]]);
  const q = S.trend(events, { unit: 'quarter', year: 2026, n: 4 }, 5);
  assert.deepEqual(q.map((x) => x.total), [2, 0, 0, 4, 7]);
});

test('排行、分類、未填身分、文字報告', () => {
  const y = { unit: 'year', year: 2026, n: 0 };
  const top = S.ranking(events, y, 'all');
  assert.deepEqual(top.slice(0, 2).map((x) => [x.name, x.count]), [['測試乙', 3], ['測試甲', 3]].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant')));
  assert.ok(S.ranking(events, y, 'dao').every((x) => x.identity === '道親'));
  assert.deepEqual(S.byCategory(events, y).map((x) => x.name), ['測試勤務', '打掃']);
  assert.deepEqual(S.missingIdentity(events, y), ['測試己']);
  const text = S.textReport(events, { unit: 'month', year: 2026, n: 10 });
  assert.match(text, /【115 年 10 月 勤務統計】/);
  assert.match(text, /勤務 2 場，出勤共 7 人次（6 位）/);
  assert.match(text, /比上月：人次 \+4/);
  assert.match(text, /比去年同月：人次 \+5/);
  assert.match(S.textReport(events, { unit: 'month', year: 2026, n: 1 }), /沒有出勤紀錄/);
});

test('還沒過完的期間：比較只算到相同天數；前幾天沒勤務算 0 不算沒有資料', () => {
  const evs = [
    ev('2025-10-01', ['測試甲'], []),
    ev('2025-10-20', ['測試甲'], ['測試乙']),
    ev('2026-07-01', ['測試甲'], ['測試乙']),
    ev('2026-07-15', ['測試甲'], []),
    ev('2026-10-02', ['測試甲'], ['測試乙', '測試丙'])
  ];
  const q = { unit: 'quarter', year: 2026, n: 4 };
  const c = S.compare(evs, q, '2026-10-02');
  assert.equal(c.partial, true);
  assert.equal(c.now.total, 3);
  assert.equal(c.ly.total, 1, '去年同季只算到 10/2');
  assert.equal(c.prev.total, 2, '上一季只算到 7/2');
  const m = S.compare(evs.slice(0, 4), { unit: 'month', year: 2026, n: 10 }, '2026-10-01');
  assert.equal(m.now.total, 0);
  assert.equal(m.ly.total, 1);
  assert.equal(m.prev.total, 0);
  assert.equal(m.prev.hasData, false, '9 月整個月沒資料');
  const full = S.compare(evs, { unit: 'quarter', year: 2026, n: 3 }, '2026-10-02');
  assert.equal(full.partial, false);
  assert.equal(full.now.total, 3);
  assert.equal(S.startOf({ unit: 'quarter', year: 2026, n: 4 }), '2026-10-01');
});

test('關懷名單：過去一年來 3 次以上、最近 N 天沒來的人，最久沒來的在前', () => {
  const C = require('../js/stats-calc.js');
  const ev = (date, tan, dao) => ({ date, name: '勤務' + date.slice(5), tan, dao, unknown: [] });
  const events = [
    ev('2026-02-01', ['測試甲'], ['測試乙']), ev('2026-03-01', ['測試甲'], ['測試乙']), ev('2026-04-01', ['測試甲'], ['測試乙']),
    ev('2026-05-01', [], ['測試乙', '測試丙']), ev('2026-09-20', [], ['測試丙']), ev('2026-09-25', [], ['測試丙']),
    ev('2024-01-01', ['很久以前'], []), ev('2024-02-01', ['很久以前'], []), ev('2024-03-01', ['很久以前'], [])
  ];
  const list = C.careList(events, '2026-10-06', 60, 3);
  assert.deepEqual(list.map((v) => [v.name, v.identity, v.count, v.last]), [['測試甲', '壇辦', 3, '2026-04-01'], ['測試乙', '道親', 4, '2026-05-01']]);
  assert.equal(list[0].daysAgo, 188);
  assert.deepEqual(C.careList(events, '2026-10-06', 30, 3).map((v) => v.name), ['測試甲', '測試乙'], '測試丙最近有來');
});

test('年齡統計：各身分的人數、平均、中位數、最小最大、年齡層；沒填年齡的不算進平均', () => {
  const C = require('../js/stats-calc.js');
  const r = C.ageStats([
    { identity: '壇辦', age: 40 }, { identity: '壇辦', age: 60 }, { identity: '壇辦', age: '' },
    { identity: '道親', age: 10 }, { identity: '道親', age: 30 }, { identity: '道親', age: 70 },
    { identity: '點傳師', age: 50 }
  ]);
  assert.deepEqual(r.map((g) => g.group), ['壇辦', '道親', '全部']);
  const tan = r[0];
  assert.deepEqual([tan.total, tan.withAge, tan.avg, tan.median, tan.min, tan.max], [3, 2, 50, 50, 40, 60]);
  const dao = r[1];
  assert.deepEqual([dao.avg, dao.median], [36.7, 30]);
  assert.deepEqual(dao.bands.map((b) => b.count), [1, 0, 1, 0, 0, 1]);
  assert.equal(r[2].withAge, 5, '點傳師不列、全部也不含');
});

test('近一年出席次數：分類別算，一年前的不算', () => {
  const C = require('../js/stats-calc.js');
  const ev = (date, category, dao) => ({ date, category, name: '測試聚會', tan: [], dao, unknown: [] });
  const m = C.activity([
    ev('2026-09-01', '勤務', ['測試甲', '測試乙']), ev('2026-08-01', '道務', ['測試甲']),
    ev('2026-07-01', '教育', ['測試甲']), ev('2025-01-01', '勤務', ['測試乙'])
  ], '2026-10-08');
  const a = m.get('測試甲');
  assert.deepEqual([a.count, a.勤務, a.道務, a.教育, a.last], [3, 1, 1, 1, '2026-09-01']);
  assert.deepEqual(Object.values(a.items).map((x) => x.category + x.name + x.count), ['勤務測試聚會1', '道務測試聚會1', '教育測試聚會1'], '同名不同類別分開算');
  assert.equal(m.get('測試乙').count, 1);
});
