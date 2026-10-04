// 「多個日期」：每週固定星期幾、貼上日期清單。純函式；瀏覽器用 window.DateList，Node 測試用 module.exports。
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function isValid(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  function weekdayOf(s) {
    return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))).getUTCDay();
  }

  function addDays(s, n) {
    return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + n)).toISOString().slice(0, 10);
  }

  /** 每週固定星期幾：from～to 之間，weekdays（0＝日…6＝六）的每一天 */
  function weekly(from, to, weekdays) {
    const out = [];
    if (!from || !to || to < from || !weekdays.length) return out;
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) {
      if (weekdays.indexOf(weekdayOf(d)) !== -1) out.push(d);
    }
    return out;
  }

  /**
   * 貼上的日期清單 → { dates: [yyyy-MM-dd]（排序、不重複）, bad: [看不懂的字] }
   * 認得：1/7、1月7日、2027/1/7、2027-01-07、2027.1.7、116/1/7（民國）；後面的（三）、(三) 會略過。
   * 只寫月日的，用 year 那一年。分隔可以是空白、換行、逗號、頓號、分號。
   */
  function parse(text, year) {
    const dates = new Set();
    const bad = [];
    const cleaned = String(text || '')
      .replace(/[（(][日一二三四五六天][)）]/g, ' ')
      .replace(/(星期|週|禮拜)[日一二三四五六天]/g, ' ');
    cleaned.split(/[\s,，、;；]+/).filter(Boolean).forEach((tok) => {
      let m = tok.match(/^(\d{2,4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
      let y; let mo; let d;
      if (m) {
        y = Number(m[1]);
        if (y < 1000) y += 1911; // 民國年
        mo = Number(m[2]); d = Number(m[3]);
      } else if ((m = tok.match(/^(\d{1,2})[\/\-.月](\d{1,2})日?$/))) {
        y = Number(year); mo = Number(m[1]); d = Number(m[2]);
      }
      if (y && isValid(y, mo, d)) dates.add(`${y}-${pad(mo)}-${pad(d)}`);
      else bad.push(tok);
    });
    return { dates: [...dates].sort(), bad };
  }

  const api = { weekly, parse, weekdayOf, WEEK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DateList = api;
})();
