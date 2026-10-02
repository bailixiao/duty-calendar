// 統計的計算（月、季、年與比較）。純函式，不碰畫面；瀏覽器用 window.StatsCalc，Node 測試用 module.exports。
// 輸入是 adminStats 回傳的 events：[{ date, dutyId, name, series, nature, tan: [], dao: [], unknown: [], accompany: [], absent, short }]
// 規則：人次＝每場每人算一次；只算出席、非陪同（伺服器已篩好）；道親佔比＝道親 ÷ 合計（含未填身分）。
(function () {
  'use strict';

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
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
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

  const api = { compare, startOf, addDays, UNIT_NAME, periodOf, shift, lastYear, contains, label, prevName, lastYearName, summarize, trend, ranking, byCategory, missingIdentity, delta, pct, textReport, eventsIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.StatsCalc = api;
})();
