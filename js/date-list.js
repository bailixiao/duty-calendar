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

  /**
   * 固定的日子：from～to 之間
   *   freq＝'w1'～'w4'：每 1～4 週的 weekdays（0＝日…6＝六），從 from 那一週（星期日開始）算第 1 週
   *   freq＝'m1'～'m4'、'mL'：每月第 1～4 個／最後一個 weekdays
   *   freq＝'day'：每月 dayOfMonth 號（沒有那天的月份略過，例如 2 月 30 號）
   */
  function weekly(from, to, weekdays, freq, dayOfMonth) {
    const out = [];
    freq = freq || 'w1';
    if (!from || !to || to < from) return out;
    if (freq === 'day' ? !(dayOfMonth >= 1 && dayOfMonth <= 31) : !weekdays.length) return out;
    const weekStart = addDays(from, -weekdayOf(from));
    const every = /^w[1-4]$/.test(freq) ? Number(freq[1]) : 0;
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) {
      const dom = Number(d.slice(8, 10));
      if (freq === 'day') { if (dom === dayOfMonth) out.push(d); continue; }
      if (weekdays.indexOf(weekdayOf(d)) === -1) continue;
      if (every) {
        if (Math.floor((Date.parse(d) - Date.parse(weekStart)) / 86400000 / 7) % every === 0) out.push(d);
      } else if (freq === 'mL') {
        if (addDays(d, 7).slice(5, 7) !== d.slice(5, 7)) out.push(d);
      } else if (Math.ceil(dom / 7) === Number(freq[1])) out.push(d);
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

  /**
   * 台灣的國定假日（放假的紀念日及節日）：{ 'yyyy-MM-dd': '名稱' }。
   * lunarToSolar(農曆年, 月, 日) → 'yyyy-MM-dd'（瀏覽器用 lunar-javascript）。
   * 不含每年行政院公告的補假、調整放假，只列節日當天。
   */
  function holidays(year, lunarToSolar) {
    const out = {};
    const put = (date, name) => { if (date) out[date] = out[date] ? out[date] + '、' + name : name; };
    const fixed = [['01-01', '元旦'], ['02-28', '和平紀念日'], ['04-04', '兒童節'], ['05-01', '勞動節'],
      ['09-28', '教師節'], ['10-10', '國慶日'], ['10-25', '臺灣光復節'], ['12-25', '行憲紀念日']];
    fixed.forEach(([md, name]) => put(`${year}-${md}`, name));
    // 清明：4/4 或 4/5（21 世紀的節氣公式）
    const y2 = year % 100;
    put(`${year}-04-${pad(Math.floor(y2 * 0.2422 + 4.81) - Math.floor(y2 / 4))}`, '清明節');
    if (lunarToSolar) {
      // 春節（初一～初三）與除夕（初一前一天）；除夕可能落在前一年，所以算今年與明年的春節
      [year, year + 1].forEach((ly) => {
        const ny = lunarToSolar(ly, 1, 1);
        [[addDays(ny, -1), '除夕'], [ny, '春節'], [addDays(ny, 1), '春節'], [addDays(ny, 2), '春節']].forEach(([d, name]) => {
          if (d.slice(0, 4) === String(year)) put(d, name);
        });
      });
      put(lunarToSolar(year, 5, 5), '端午節');
      put(lunarToSolar(year, 8, 15), '中秋節');
    }
    return out;
  }

  /**
   * 放假日與連假：{ 'yyyy-MM-dd': { name, kind } }，kind＝'holiday'（國定假日）／'makeup'（補假）／'weekend'（連假裡的六日）
   *   補假：國定假日遇星期六→前一天星期五補假；遇星期日→隔天星期一補假（行政院每年的調整放假不在內）。
   *   連假：國定假日、補假、六日連在一起 3 天以上；連假裡的六日也列出來（很多人會出遊）。
   */
  function offDays(years, lunarToSolar) {
    const hol = {};
    years.forEach((y) => Object.assign(hol, holidays(y, lunarToSolar)));
    const off = {};
    Object.keys(hol).forEach((d) => { off[d] = { name: hol[d], kind: 'holiday' }; });
    Object.keys(hol).forEach((d) => {
      const wd = weekdayOf(d);
      const mk = wd === 6 ? addDays(d, -1) : wd === 0 ? addDays(d, 1) : null;
      if (mk && !off[mk]) off[mk] = { name: hol[d] + '補假', kind: 'makeup' };
    });
    // 找連在一起的放假日（含六日），3 天以上算連假
    const isOff = (d) => !!off[d] || weekdayOf(d) === 0 || weekdayOf(d) === 6;
    const seen = new Set();
    Object.keys(off).sort().forEach((d) => {
      if (seen.has(d)) return;
      let a = d;
      while (isOff(addDays(a, -1))) a = addDays(a, -1);
      let b = d;
      while (isOff(addDays(b, 1))) b = addDays(b, 1);
      const run = [];
      for (let x = a; x <= b; x = addDays(x, 1)) { run.push(x); seen.add(x); }
      if (run.length < 3) return;
      const names = [...new Set(run.filter((x) => off[x] && off[x].kind === 'holiday').map((x) => off[x].name.split('、')[0]))];
      const label = (names.length ? names.join('・') : '') + '連假';
      run.forEach((x) => { if (!off[x]) off[x] = { name: label, kind: 'weekend' }; });
    });
    return off;
  }

  const api = { weekly, parse, weekdayOf, WEEK, holidays, offDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DateList = api;
})();
