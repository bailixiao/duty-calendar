// 統計的計算（月、季、年與比較）。純函式，不碰畫面；瀏覽器用 window.StatsCalc，Node 測試用 module.exports。
// 輸入是 adminStats 回傳的 events：[{ date, dutyId, name, series, nature, tan: [], dao: [], unknown: [], accompany: [], absent, short }]
// 規則：人次＝每場每人算一次；只算出席、非陪同（伺服器已篩好）；道親佔比＝道親 ÷ 合計（含未填身分）。
(function () {
  'use strict';

  // 同次數依姓的筆劃排（與 Fmt.byStroke 相同）
  const strokeCompare = new Intl.Collator('zh-Hant-TW-u-co-stroke').compare;

  const UNIT_NAME = { month: '月', quarter: '季', year: '年' };

  /** 期間：{ unit: 'month'|'quarter'|'year', year, n }（月 n＝1–12、季 n＝1–4、年 n＝0） */
  function periodOf(unit, dateStr) {
    const y = Number(dateStr.slice(0, 4));
    const m = Number(dateStr.slice(5, 7));
    if (unit === 'month') return { unit, year: y, n: m };
    if (unit === 'quarter') return { unit, year: y, n: Math.ceil(m / 3) };
    return { unit, year: y, n: 0 };
  }

  /** 往前（step<0）或往後移幾期 */
  function shift(p, step) {
    if (p.unit === 'year') return { unit: 'year', year: p.year + step, n: 0 };
    const size = p.unit === 'month' ? 12 : 4;
    const idx = p.year * size + (p.n - 1) + step;
    return { unit: p.unit, year: Math.floor(idx / size), n: (idx % size + size) % size + 1 };
  }

  function lastYear(p) {
    return { unit: p.unit, year: p.year - 1, n: p.n };
  }

  function contains(p, dateStr) {
    const q = periodOf(p.unit, dateStr);
    return q.year === p.year && q.n === p.n;
  }

  /** short：true＝圖表用的短標籤；'plain'＝季不加月份範圍 */
  function label(p, short) {
    const roc = p.year - 1911;
    if (short === 'plain' && p.unit === 'quarter') return `${roc} 年第 ${p.n} 季`;
    if (p.unit === 'month') return short === true ? `${p.n}月` : `${roc} 年 ${p.n} 月`;
    if (p.unit === 'quarter') return short === true ? `${roc}年Q${p.n}` : `${roc} 年第 ${p.n} 季（${p.n * 3 - 2}–${p.n * 3} 月）`;
    return short === true ? `${roc}年` : `${roc} 年`;
  }

  /** 比較時的稱呼：上月、上一季、去年；去年同月、去年同季 */
  function prevName(unit) {
    return unit === 'month' ? '上月' : unit === 'quarter' ? '上一季' : '前一年';
  }
  function lastYearName(unit) {
    return unit === 'month' ? '去年同月' : unit === 'quarter' ? '去年同季' : '';
  }

  function eventsIn(events, p) {
    return events.filter((e) => contains(p, e.date));
  }

  /** 一段期間的彙總；until（選填）：只算到這一天（比較還沒過完的期間時用） */
  function summarize(events, p, until) {
    const list = eventsIn(events, p).filter((e) => !until || e.date <= until);
    const r = { events: list.length, tan: 0, dao: 0, unknown: 0, accompany: 0, absent: 0, shortEvents: 0 };
    const people = new Set();
    list.forEach((e) => {
      r.tan += e.tan.length;
      r.dao += e.dao.length;
      r.unknown += e.unknown.length;
      r.accompany += e.accompany.length;
      r.absent += e.absent || 0;
      if (e.short > 0) r.shortEvents += 1;
      e.tan.concat(e.dao, e.unknown).forEach((n) => people.add(n));
    });
    r.total = r.tan + r.dao + r.unknown;
    r.ratio = r.total ? r.dao / r.total : null; // 沒資料時是 null（畫面顯示「—」，不會除以零）
    r.people = people.size;
    r.hasData = list.length > 0;
    return r;
  }

  /** 最近幾期（含本期，舊到新） */
  function trend(events, p, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const q = shift(p, -i);
      out.push(Object.assign({ period: q }, summarize(events, q)));
    }
    return out;
  }

  /** 出勤次數排行。kind：'all'|'tan'|'dao' */
  function ranking(events, p, kind) {
    const map = new Map();
    eventsIn(events, p).forEach((e) => {
      const add = (names, identity) => names.forEach((n) => {
        const v = map.get(n) || { name: n, identity, count: 0 };
        v.count += 1;
        if (!v.identity) v.identity = identity;
        map.set(n, v);
      });
      if (kind !== 'dao') add(e.tan, '壇辦');
      if (kind !== 'tan') add(e.dao, '道親');
      if (kind === 'all') add(e.unknown, '');
    });
    return [...map.values()].sort((a, b) => b.count - a.count || strokeCompare(a.name, b.name));
  }

  /**
   * 關懷名單：過去一年（到 today 為止）出席至少 minCount 次，但最近 days 天沒有出席的人。
   * 回傳 [{ name, identity, count（過去一年出席次數）, last（最後出席日）, lastName（最後出席的項目）, daysAgo }]，最久沒來的在前。
   */
  function careList(events, today, days, minCount) {
    const from = addDays(today, -365);
    const cut = addDays(today, -(days || 60));
    const map = new Map();
    events.filter((e) => e.date >= from && e.date <= today).forEach((e) => {
      const add = (names, identity) => names.forEach((n) => {
        const v = map.get(n) || { name: n, identity, count: 0, last: '', lastName: '' };
        v.count += 1;
        if (!v.identity) v.identity = identity;
        if (e.date > v.last) { v.last = e.date; v.lastName = e.name; }
        map.set(n, v);
      });
      add(e.tan, '壇辦');
      add(e.dao, '道親');
      add(e.unknown, '');
    });
    return [...map.values()]
      .filter((v) => v.count >= (minCount || 3) && v.last < cut)
      .map((v) => Object.assign(v, { daysAgo: daysBetween(v.last, today) }))
      .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : strokeCompare(a.name, b.name)));
  }

  /**
   * 近一年每個人出席幾次（全部類別）：回傳 Map 名字 → { count, 勤務, 道務, 教育, last（最近一次日期）, items: { '類別|項目': { name, category, count } } }。
   * 名字和統計一樣（同名不同佛堂的會是「名字（佛堂）」）。
   */
  function activity(events, today, days) {
    const from = addDays(today, -(days || 365));
    const map = new Map();
    events.filter((e) => e.date >= from && e.date <= today).forEach((e) => {
      const cat = e.category || '勤務';
      e.tan.concat(e.dao, e.unknown).forEach((n) => {
        const v = map.get(n) || { count: 0, 勤務: 0, 道務: 0, 教育: 0, last: '', items: {} };
        v.count += 1;
        if (v[cat] !== undefined) v[cat] += 1;
        if (e.date > v.last) v.last = e.date;
        const key = cat + '|' + (e.series || e.name);
        const it = v.items[key] || (v.items[key] = { name: e.series || e.name, category: cat, count: 0 });
        it.count += 1;
        map.set(n, v);
      });
    });
    return map;
  }

  const AGE_BANDS = [['14 歲以下', 0, 14], ['15–29', 15, 29], ['30–44', 30, 44], ['45–54', 45, 54], ['55–64', 55, 64], ['65 歲以上', 65, 200]];

  /**
   * 年齡統計（成員名單）：members = [{ identity, age }]（age 空白＝沒填）。
   * 回傳 [{ group, total, withAge, avg, median, min, max, bands: [{ label, count }] }]，group 依序：壇辦、道親、未求道、全部（沒有人的身分不列；點傳師不算，全部也不含）。
   */
  function ageStats(members) {
    const groups = ['壇辦', '道親', '未求道'];
    const one = (group, list) => {
      const ages = list.filter((m) => m.age !== '' && m.age !== null && m.age !== undefined).map((m) => Number(m.age)).filter((a) => m0(a)).sort((a, b) => a - b);
      const n = ages.length;
      const median = !n ? null : n % 2 ? ages[(n - 1) / 2] : (ages[n / 2 - 1] + ages[n / 2]) / 2;
      return {
        group, total: list.length, withAge: n,
        avg: n ? Math.round((ages.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null,
        median, min: n ? ages[0] : null, max: n ? ages[n - 1] : null,
        bands: AGE_BANDS.map(([label, lo, hi]) => ({ label, count: ages.filter((a) => a >= lo && a <= hi).length }))
      };
    };
    const m0 = (a) => typeof a === 'number' && !isNaN(a) && a >= 0 && a <= 120;
    return groups.map((g) => one(g, members.filter((m) => m.identity === g))).filter((r) => r.total)
      .concat([one('全部', members.filter((m) => m.identity !== '點傳師'))]);
  }

  /** 依勤務分類（同名勤務合併，例如各月的拜香輪值） */
  function byCategory(events, p) {
    const map = new Map();
    eventsIn(events, p).forEach((e) => {
      const v = map.get(e.series) || { name: e.series, events: 0, total: 0, dao: 0 };
      v.events += 1;
      v.total += e.tan.length + e.dao.length + e.unknown.length;
      v.dao += e.dao.length;
      map.set(e.series, v);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /** 未填身分的人（需要到試算表或名單補上） */
  function missingIdentity(events, p) {
    const set = new Set();
    eventsIn(events, p).forEach((e) => e.unknown.forEach((n) => set.add(n)));
    return [...set];
  }

  /** 差異：{ text: '+12'／'−3'／'持平'／null（沒資料）, sign } */
  function delta(now, before, isRatio) {
    if (before === null || before === undefined || now === null || now === undefined) return { text: null, sign: 0 };
    const d = isRatio ? Math.round((now - before) * 100) : now - before;
    if (d === 0) return { text: '持平', sign: 0 };
    return { text: (d > 0 ? '+' : '−') + Math.abs(d) + (isRatio ? '%' : ''), sign: d > 0 ? 1 : -1 };
  }

  function pct(ratio) {
    return ratio === null ? '—' : Math.round(ratio * 100) + '%';
  }

  /** 給 LINE 群組的文字報告 */
  function textReport(events, p) {
    const s = summarize(events, p);
    const prev = summarize(events, shift(p, -1));
    const ly = p.unit === 'year' ? null : summarize(events, lastYear(p));
    const lines = [`【${label(p)} 勤務統計】`];
    if (!s.hasData) {
      lines.push('這段期間沒有出勤紀錄。');
      return lines.join('\n');
    }
    lines.push(`勤務 ${s.events} 場，出勤共 ${s.total} 人次（${s.people} 位）`);
    lines.push(`道親 ${s.dao} 人次、壇辦 ${s.tan} 人次${s.unknown ? `、未填身分 ${s.unknown} 人次` : ''}`);
    lines.push(`道親佔比 ${pct(s.ratio)}`);
    const cmp = (name, o) => {
      if (!o || !o.hasData) return;
      const d = delta(s.total, o.total);
      const r = delta(s.ratio, o.ratio, true);
      lines.push(`比${name}：人次 ${d.text}，道親佔比 ${r.text}`);
    };
    cmp(prevName(p.unit), prev);
    if (ly) cmp(lastYearName(p.unit), ly);
    const top = ranking(events, p, 'all').slice(0, 5).filter((x) => x.count > 1);
    if (top.length) lines.push(`出勤最多：${top.map((x) => `${x.name}（${x.count} 次）`).join('、')}`);
    lines.push('感恩大家的護持與付出！');
    return lines.join('\n');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 期間的第一天 'yyyy-MM-dd' */
  function startOf(p) {
    const m = p.unit === 'month' ? p.n : p.unit === 'quarter' ? p.n * 3 - 2 : 1;
    return `${p.year}-${pad2(m)}-01`;
  }

  function addDays(dateStr, n) {
    const d = new Date(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) + n * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  function daysBetween(a, b) {
    const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.round((t(b) - t(a)) / 86400000);
  }

  /**
   * 本期與比較期間（上一期、去年同期）。本期還沒過完（含今天）時，比較期間也只算到相同的天數，
   * 例如本季到 10/2 → 去年同季算到去年 10/2、上一季算到 7/2，比較才公平。
   * 回傳 { now, prev, prevP, ly, lyP, partial }
   */
  function compare(events, p, today) {
    const prevP = shift(p, -1);
    const lyP = p.unit === 'year' ? null : lastYear(p);
    const partial = contains(p, today);
    const elapsed = partial ? daysBetween(startOf(p), today) : null;
    // 比較期間：只算到相同天數，但「有沒有資料」看整段（前幾天剛好沒勤務算 0，不算沒有資料）
    const cut = (q) => {
      if (!q) return null;
      const r = summarize(events, q, partial ? addDays(startOf(q), elapsed) : undefined);
      r.hasData = summarize(events, q).hasData;
      return r;
    };
    return { now: summarize(events, p), prevP, prev: cut(prevP), lyP, ly: cut(lyP), partial };
  }


  /**
   * 🔍 變化的原因（2026/11/23）：這一期和比較的期間（vs＝'prev' 上一期、'ly' 去年同期）差在哪裡。
   * 本期還沒過完時，比較的期間只算到相同天數（和 compare 一樣）。回傳
   *   { q, a, b（兩期的 summarize）, ratio: { from, to, dDao, dTan, why }, count: { why, avgA, avgB },
   *     items: [{ name, a: {dao,tan,total,events}, b: {...}, d }]（依活動名稱，差最多的在前）,
   *     lostDao: [名字]（上一期有來的道親、這一期沒來）, newDao: [名字]（這一期才來的道親） }
   *   比較的期間沒有資料回傳 null。
   */
  function explain(events, p, today, vs) {
    const q = vs === 'ly' ? (p.unit === 'year' ? null : lastYear(p)) : shift(p, -1);
    if (!q) return null;
    const partial = contains(p, today);
    const untilB = partial ? addDays(startOf(q), daysBetween(startOf(p), today)) : null;
    const A = eventsIn(events, p).filter((e) => !partial || e.date <= today);
    const B = eventsIn(events, q).filter((e) => !untilB || e.date <= untilB);
    if (!B.length) return null;
    const sum = (list) => list.reduce((r, e) => { r.dao += e.dao.length; r.tan += e.tan.length; r.total += e.dao.length + e.tan.length + e.unknown.length; r.events += 1; return r; }, { dao: 0, tan: 0, total: 0, events: 0 });
    const a = sum(A), b = sum(B);
    const ra = a.total ? a.dao / a.total : null, rb = b.total ? b.dao / b.total : null;
    const dDao = a.dao - b.dao, dTan = a.tan - b.tan;
    // 道親佔比為什麼變：道親變少，還是壇辦變多
    let why = '';
    if (ra !== null && rb !== null) {
      const diff = Math.round((ra - rb) * 100);
      const dd = (n) => (n > 0 ? '多 ' + n : n < 0 ? '少 ' + -n : '一樣');
      if (Math.abs(diff) < 3) why = '道親佔比差不多（' + pct(rb) + ' → ' + pct(ra) + '）。';
      else if (diff < 0) {
        why = '道親佔比從 ' + pct(rb) + ' 降到 ' + pct(ra) + '：'
          + (dDao >= 0 && dTan > 0 ? '道親沒有變少（' + dd(dDao) + ' 人次），主要是壇辦多了 ' + dTan + ' 人次。'
            : dDao < 0 && dTan > 0 ? '道親少了 ' + -dDao + ' 人次，壇辦又多了 ' + dTan + ' 人次。'
              : '道親少了 ' + -dDao + ' 人次，比壇辦少得多（壇辦' + dd(dTan) + ' 人次）。');
      } else {
        why = '道親佔比從 ' + pct(rb) + ' 升到 ' + pct(ra) + '：'
          + (dDao > 0 && dTan <= 0 ? '道親多了 ' + dDao + ' 人次' + (dTan < 0 ? '，壇辦少了 ' + -dTan + ' 人次' : '') + '。'
            : dDao > 0 ? '道親多了 ' + dDao + ' 人次，比壇辦多得多（壇辦' + dd(dTan) + ' 人次）。'
              : '道親沒有變多（' + dd(dDao) + ' 人次），是壇辦少了 ' + -dTan + ' 人次。');
      }
    }
    // 人次為什麼變：場次變多／少，還是每場的人變多／少
    const avgA = a.events ? a.total / a.events : 0, avgB = b.events ? b.total / b.events : 0;
    const r1 = (n) => Math.round(n * 10) / 10;
    let countWhy = '';
    const dT = a.total - b.total;
    if (dT === 0) countWhy = '出勤人次一樣（' + a.total + ' 人次）。';
    else {
      const byEvents = (a.events - b.events) * avgB; // 場次變了帶來的人次
      const byAvg = (avgA - avgB) * a.events; // 每場人數變了帶來的人次
      countWhy = '出勤人次' + (dT > 0 ? '多了 ' + dT : '少了 ' + -dT) + '（' + b.total + ' → ' + a.total + '）：'
        + '場次 ' + b.events + ' → ' + a.events + '、平均每場 ' + r1(avgB) + ' → ' + r1(avgA) + ' 人。'
        + (Math.abs(byEvents) >= Math.abs(byAvg) ? '主要是場次' + (a.events > b.events ? '變多' : '變少') + '。' : '主要是每場來的人' + (avgA > avgB ? '變多' : '變少') + '。');
    }
    // 依活動名稱：差最多的活動
    const byName = new Map();
    const put = (list, key) => list.forEach((e) => {
      const n = e.series || e.name;
      if (!byName.has(n)) byName.set(n, { name: n, a: { dao: 0, tan: 0, total: 0, events: 0 }, b: { dao: 0, tan: 0, total: 0, events: 0 } });
      const x = byName.get(n)[key];
      x.dao += e.dao.length; x.tan += e.tan.length; x.total += e.dao.length + e.tan.length + e.unknown.length; x.events += 1;
    });
    put(A, 'a'); put(B, 'b');
    const items = [...byName.values()].map((x) => Object.assign(x, { d: x.a.total - x.b.total, dDao: x.a.dao - x.b.dao, dTan: x.a.tan - x.b.tan }))
      .filter((x) => x.d || x.dDao).sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || Math.abs(y.dDao) - Math.abs(x.dDao));
    // 人：上一期有來的道親這一期沒來、這一期才來的道親
    const names = (list, k) => new Set([].concat(...list.map((e) => e[k])));
    const daoA = names(A, 'dao'), daoB = names(B, 'dao');
    const anyB = new Set([].concat(...B.map((e) => e.dao.concat(e.tan, e.unknown))));
    const lostDao = [...daoB].filter((n) => !daoA.has(n)).sort(strokeCompare);
    const newDao = [...daoA].filter((n) => !daoB.has(n) && !anyB.has(n)).sort(strokeCompare);
    return { q, partial, a, b, ratio: { from: rb, to: ra, dDao, dTan, why }, count: { why: countWhy, avgA, avgB }, items, lostDao, newDao };
  }

  const api = { explain, activity, ageStats, careList, compare, startOf, addDays, UNIT_NAME, periodOf, shift, lastYear, contains, label, prevName, lastYearName, summarize, trend, ranking, byCategory, missingIdentity, delta, pct, textReport, eventsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.StatsCalc = api;
})();
