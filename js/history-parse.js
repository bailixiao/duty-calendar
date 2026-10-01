// 匯入歷史資料：解析舊的《教全區勤務統計》Excel（每月一個分頁）。純函式，不碰畫面；
// 瀏覽器用 window.HistoryParse，Node 測試用 module.exports（tests/history-parse.test.js）。
//
// 每月分頁的格式（欄位位置各月不一定相同，一律依標題列找欄位）：
//   標題列含「活動項目」「日期」「性質」「壇辦姓名」「道親姓名」，「備註」在標題列或上一列
//   每一場的第一列「活動項目」有值，下面幾列是同一場的其他人（活動項目空白）
//   日期是 Excel 日期序號（例 46266＝2026-09-01）或「2026/9/1」文字
//   備註裡的名字是陪同者（規格第 10 節），以「、」「,」「.」或空白分隔
// 「統計」分頁：各月的壇辦人數、道親人數，用來核對匯入結果。
(function () {
  'use strict';

  function clean(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[\s　]+/g, ' ').trim();
  }

  /** 名字：去掉所有空白 */
  function cleanName(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[\s　]+/g, '');
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Excel 日期序號或文字 → 'yyyy-MM-dd'，看不懂回傳 '' */
  function toDate(v) {
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const m = /^(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(clean(v));
    if (!m) return '';
    const y = Number(m[1]) < 1911 ? Number(m[1]) + 1911 : Number(m[1]);
    return `${y}-${pad(m[2])}-${pad(m[3])}`;
  }

  /**
   * 日期欄 → { start, end }：Excel 序號、「2026/9/1」，或沒寫年份的「8/24」「8/24~8/31」（多天勤務，年份用 year）。
   * 看不懂回傳 null。
   */
  function toDateRange(v, year) {
    const one = toDate(v);
    if (one) return { start: one, end: one };
    const s = clean(v);
    const m = /^(\d{1,2})\/(\d{1,2})(?:\s*[~～\-–至到]\s*(?:(\d{1,2})\/)?(\d{1,2}))?$/.exec(s);
    if (!m || !year) return null;
    const start = `${year}-${pad(m[1])}-${pad(m[2])}`;
    if (!m[4]) return { start, end: start };
    let end = `${year}-${pad(m[3] || m[1])}-${pad(m[4])}`;
    if (end < start) end = `${year + 1}-${pad(m[3] || m[1])}-${pad(m[4])}`; // 跨年
    return { start, end };
  }

  /** 分頁標題「2025/8月教全區勤務統計分析表」的年份 */
  function titleYear(rows) {
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      for (const v of rows[i] || []) {
        const m = /(\d{4})\s*\/\s*\d{1,2}\s*月/.exec(clean(v));
        if (m) return Number(m[1]);
      }
    }
    return 0;
  }

  function splitNames(v) {
    return clean(v).split(/[、,，.．;；\s]+/).map(cleanName).filter((x) => x);
  }

  /** 找標題列與欄位位置 */
  function findColumns(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = (rows[i] || []).map(clean);
      if (r.indexOf('活動項目') === -1 || r.indexOf('壇辦姓名') === -1) continue;
      const col = (name) => r.indexOf(name);
      const date = col('日期') !== -1 ? col('日期') : col('日期-1');
      const dateAlt = col('日期-1');
      const prevRow = (rows[i - 1] || []).map(clean);
      let note = col('備註');
      if (note === -1) note = prevRow.indexOf('備註');
      return {
        header: i, name: col('活動項目'), nameAlt: col('活動項目-1'), date, dateAlt, nature: col('性質'),
        tan: col('壇辦姓名'), dao: col('道親姓名'), note
      };
    }
    return null;
  }

  /**
   * 解析一個月的分頁。rows：二維陣列（SheetJS sheet_to_json header:1 的結果）。
   * yearHint：標題沒寫年份時用（例如檔名的年份）。
   * 回傳 { events: [{ date, end, name, nature, tan: [], dao: [], accompany: [] }], problems: [字串] }
   * 多天勤務（日期寫「8/24~8/31」）：date＝第一天、end＝最後一天，每人只算一次（與原 Excel 相同）。
   */
  function parseMonth(rows, yearHint) {
    const c = findColumns(rows);
    if (!c) return { events: [], problems: ['找不到標題列（要有「活動項目」「壇辦姓名」）'] };
    const year = titleYear(rows) || yearHint || 0;
    const events = [];
    const problems = [];
    let cur = null;
    for (let i = c.header + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = clean(r[c.name]);
      const tan = cleanName(r[c.tan]);
      const dao = cleanName(r[c.dao]);
      let range = name ? toDateRange(r[c.date], year) : null;
      if (name && !range && c.dateAlt !== -1) range = toDateRange(r[c.dateAlt], year);
      const date = range ? range.start : '';
      // 有些月份每一列都重複寫活動項目：同名、同日（或沒寫日期）的下一列算同一場
      const sameEvent = cur && name === cur.name && (!date || date === cur.date);
      if (name && !sameEvent) {
        const nature = clean(r[c.nature]);
        cur = { date, end: range ? range.end : '', name, nature: ['勤務', '支援', '烹飪'].indexOf(nature) !== -1 ? nature : '勤務', tan: [], dao: [], accompany: [], row: i + 1 };
        if (!date) problems.push(`第 ${i + 1} 列「${name}」沒有日期`);
        events.push(cur);
      } else if (!cur && (tan || dao)) {
        problems.push(`第 ${i + 1} 列有名字但不知道是哪一場`);
        continue;
      }
      if (!cur) continue;
      if (tan) cur.tan.push(tan);
      if (dao) cur.dao.push(dao);
      // 備註：2–4 個字的當作陪同者姓名；其他（一個字、說明文字、黏在一起的名字）列出來給管理者看
      if (c.note !== -1 && r[c.note] !== undefined) {
        splitNames(r[c.note]).forEach((n) => {
          if (n.length >= 2 && n.length <= 4) cur.accompany.push(n);
          else problems.push(`第 ${i + 1} 列備註「${n}」不像姓名，沒有匯入`);
        });
      }
    }
    return { events: events.filter((e) => e.date), problems };
  }

  /** 「統計」分頁：{ 月份數字: { tan, dao } }，核對用 */
  function parseSummary(rows) {
    const out = {};
    (rows || []).forEach((r) => {
      const m = /^(\d{1,2})月$/.exec(clean((r || [])[0]));
      if (m && typeof r[1] === 'number') out[Number(m[1])] = { tan: r[1], dao: Number(r[2]) || 0 };
    });
    return out;
  }

  /**
   * 整本活頁簿。sheets：{ 分頁名稱: rows }；yearHint：檔名上的年份（標題沒寫年份時用）。回傳
   *   { months: [{ month, events, tan, dao, expected: { tan, dao } | null, problems }] }
   */
  function parseWorkbook(sheets, yearHint) {
    const summary = parseSummary(sheets['統計']);
    const months = [];
    Object.keys(sheets).forEach((title) => {
      const m = /^(\d{1,2})月$/.exec(title.trim());
      if (!m) return;
      const res = parseMonth(sheets[title], yearHint);
      const month = Number(m[1]);
      const count = (k) => res.events.reduce((n, e) => n + e[k].length, 0);
      months.push({ month, events: res.events, tan: count('tan'), dao: count('dao'), expected: summary[month] || null, problems: res.problems });
    });
    months.sort((a, b) => a.month - b.month);
    return { months };
  }

  /**
   * 疑似同一人：只差異體字（藴／蘊），或沒寫姓的簡稱包含在全名裡（小明／王小明）。
   * 兩個不同的全名不會被歸在一起（避免「陳○乙」「李○乙」一路串成一大組）。
   * 每組附 suggest：組內只有一個全名、或只差異體字時，建議統一成的寫法；否則是空字串（建議各自保留）。
   * names：全部名字（可重複，用來算次數）。回傳 [{ names: [{ name, count }] }]，次數多的排前面。
   */
  const VARIANTS = [['藴', '蘊'], ['台', '臺'], ['峯', '峰'], ['綉', '繡'], ['群', '羣'], ['凃', '涂'], ['ㄧ', '一']];
  function variantKey(n) {
    return VARIANTS.reduce((s, [a, b]) => s.split(a).join(b), n);
  }

  function similarGroups(names) {
    const counts = new Map();
    names.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    const list = [...counts.keys()];
    const parent = new Map(list.map((n) => [n, n]));
    const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const [short, long] = a.length <= b.length ? [a, b] : [b, a];
        const contained = short.length >= 2 && short.length < long.length && long.length >= 3 && long.length <= 4 && long.indexOf(short) !== -1;
        if (variantKey(a) === variantKey(b) || contained) parent.set(find(a), find(b));
      }
    }
    const groups = new Map();
    list.forEach((n) => {
      const r = find(n);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push({ name: n, count: counts.get(n) });
    });
    return [...groups.values()].filter((g) => g.length > 1)
      .map((g) => {
        g.sort((a, b) => b.count - a.count || b.name.length - a.name.length);
        const longest = Math.max(...g.map((n) => n.name.length));
        const fulls = g.filter((n) => n.name.length === longest);
        const fullKeys = new Set(fulls.map((n) => variantKey(n.name)));
        // 全名只有一種寫法（異體字算同一種）才建議合併，合併成出現最多次的全名
        return { names: g, suggest: fullKeys.size === 1 ? fulls[0].name : '' };
      });
  }

  const api = { toDate, toDateRange, parseMonth, parseSummary, parseWorkbook, similarGroups, splitNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.HistoryParse = api;
})();
