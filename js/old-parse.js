// 從檔案帶入舊資料（2026/11/26）：Excel、Word 的表格不經過 AI，直接讀成一場一場。純函式，不碰畫面；
// 瀏覽器用 window.OldParse，Node 測試用 module.exports（tests/old-parse.test.js）。規格見 docs/spec.md「從檔案帶入舊資料」。
//   前 15 列找表頭：要有「日期」和名稱欄；可以有時間、地點、類別、人員欄（「壇辦」「道親」「點傳師」欄的人身分就是那個）。
//   名稱和日期空白、只有人名的列＝上一場的人；只有日期沒有名稱＝跟上一場同名（合併儲存格）。
(function (root) {
  'use strict';

  const CATS = ['勤務', '道務', '教育'];
  const IDS = ['壇辦', '道親', '點傳師', '未求道'];
  const pad = (n) => String(n).padStart(2, '0');
  const clean = (v) => String(v === undefined || v === null ? '' : v).normalize('NFKC').replace(/[\s　]+/g, ' ').trim();
  const key = (v) => clean(v).replace(/\s/g, '');

  /** 檔名、分頁名稱、標題裡的年份：2025、114年、民國114 → 西元 */
  function yearOf(text) {
    const s = clean(text);
    let m = /(20\d\d)/.exec(s);
    if (m) return Number(m[1]);
    m = /(?:民國)?\s*(1[0-2]\d)\s*年/.exec(s) || /民國\s*(1[0-2]\d)/.exec(s);
    return m ? Number(m[1]) + 1911 : 0;
  }

  function ymd(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (y < 1911 && y > 0) y += 1911;
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return '';
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** 一個日期：Date、Excel 序號、2025/3/7、114/3/7、114年3月7日、3/7（year） */
  function oneDate(v, year) {
    if (v instanceof Date && !isNaN(v)) {
      const t = new Date(v.getTime() + 12 * 3600000); // SheetJS 的日期可能是本地午夜或 UTC 午夜，加半天再取 UTC 的年月日都對
      return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    }
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(clean(v))) {
      const n = Math.floor(Number(v));
      if (n < 30000 || n > 80000) return '';
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = clean(v).replace(/[（(][^）)]*[）)]/g, '').replace(/星期.|週.|禮拜./g, '').trim();
    let m = /^(\d{2,4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/.exec(s);
    if (m) return ymd(m[1], m[2], m[3]);
    m = /^(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/.exec(s);
    if (m && year) return ymd(year, m[1], m[2]);
    return '';
  }

  /** 日期格 → { start, end }：一天或 8/24~8/31（結束沒寫月份照開始的月份；跨年自動加一年）。看不懂回傳 null */
  function dateRange(v, year) {
    const one = oneDate(v, year);
    const s = clean(v);
    const parts = typeof v === 'string' ? s.split(/\s*[~～至到–—]\s*|\s+-\s+/) : [];
    if (parts.length === 2 && parts[0] && parts[1]) {
      const start = oneDate(parts[0], year);
      if (start) {
        let end = oneDate(parts[1], Number(start.slice(0, 4)));
        if (!end && /^\d{1,2}$/.test(parts[1])) end = ymd(start.slice(0, 4), start.slice(5, 7), parts[1]);
        if (end && end < start) end = ymd(Number(end.slice(0, 4)) + 1, end.slice(5, 7), end.slice(8, 10));
        return { start, end: end && end > start ? end : '' };
      }
    }
    if (one) return { start: one, end: '' };
    const m = /^(\d{1,2})[/.](\d{1,2})\s*-\s*(\d{1,2})$/.exec(s); // 8/24-31
    if (m && year) { const st = ymd(year, m[1], m[2]); const en = ymd(year, m[1], m[3]); if (st) return { start: st, end: en > st ? en : '' }; }
    return null;
  }

  /** 時間：08:00-12:00、8:00～12:00、0800-1200、Date（Excel 時間） */
  function timeRange(v) {
    if (v instanceof Date && !isNaN(v)) return { start: `${pad(v.getHours())}:${pad(v.getMinutes())}`, end: '' };
    if (typeof v === 'number' && v > 0 && v < 1) { const mins = Math.round(v * 1440); return { start: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`, end: '' }; }
    const s = clean(v).replace(/：/g, ':');
    const t = (x) => { const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(x || ''); if (!m || Number(m[1]) > 23) return ''; return `${pad(m[1])}:${m[2] || '00'}`; };
    const m = /(\d{1,2}:?\d{2})\s*(?:[~～\-–—至到]\s*(\d{1,2}:?\d{2}))?/.exec(s);
    return m ? { start: t(m[1]), end: t(m[2]) } : { start: '', end: '' };
  }

  /** 一格的人名 → 名字陣列：「、，, ／ 空白 換行」分開，去掉括號、編號、「等」 */
  function peopleOf(v) {
    return String(v === undefined || v === null ? '' : v).normalize('NFKC')
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .split(/[、,，;；/／|\s\n]+/)
      .map((x) => x.replace(/^\d+[.、)]?/, '').replace(/等$/, '').trim())
      .filter((x) => x && !/^\d+$/.test(x) && /[一-鿿A-Za-z]/.test(x) && !/^(無|共|合計|小計|人)$/.test(x) && x.length <= 10);
  }

  const RE = {
    date: /日期/,
    name: /活動項目|活動名稱|勤務名稱|勤務項目|課程名稱|名稱|項目|勤務|活動|課程|班別/,
    time: /時間|時段/,
    location: /地點|場地|佛堂/,
    cat: /類別|性質|類型/,
    people: /姓名|人員|名單|參加|出席|出勤|了愿|壇辦|道親|點傳師|志工|組員|人名/,
    skip: /備註|電話|手機|地址|人數|合計|說明|內容|負責組/
  };

  /** 找表頭：{ index, cols: { date, name, time, endTime, location, cat, people: [{ i, identity }] } } 或 null */
  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const cells = (rows[r] || []).map(key);
      const cols = { date: -1, name: -1, time: -1, endTime: -1, location: -1, cat: -1, people: [] };
      cells.forEach((c, i) => {
        if (!c || c.length > 12) return;
        if (cols.date === -1 && RE.date.test(c)) { cols.date = i; return; }
        if (/結束時間/.test(c)) { cols.endTime = i; return; }
        if (cols.time === -1 && RE.time.test(c)) { cols.time = i; return; }
        if (RE.skip.test(c)) return;
        if (RE.people.test(c)) { cols.people.push({ i, identity: IDS.find((x) => c.indexOf(x) !== -1) || '' }); return; }
        if (cols.location === -1 && RE.location.test(c)) { cols.location = i; return; }
        if (cols.cat === -1 && RE.cat.test(c)) { cols.cat = i; return; }
        if (cols.name === -1 && RE.name.test(c)) cols.name = i;
      });
      if (cols.date !== -1 && cols.name !== -1) return { index: r, cols };
    }
    return null;
  }

  /**
   * 一個表格 → { header: 有沒有找到表頭, sessions: [...], problems: [字串] }
   * opts = { year, label }
   */
  function parseTable(rows, opts) {
    opts = opts || {};
    const h = findHeader(rows || []);
    if (!h) return { header: false, sessions: [], problems: [] };
    const year = Number(opts.year) || yearOf(opts.label) || yearOf((rows.slice(0, h.index) || []).map((r) => (r || []).join(' ')).join(' '));
    const c = h.cols;
    const out = [];
    const problems = [];
    let prev = null;
    for (let r = h.index + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = clean(row[c.name]);
      const rawDate = row[c.date];
      const people = [];
      c.people.forEach((p) => peopleOf(row[p.i]).forEach((n) => people.push({ name: n, identity: p.identity })));
      if (/合計|小計|總計|共計/.test(name) || /合計|小計|總計|共計/.test(clean(rawDate))) continue;
      if (!name && !clean(rawDate)) {
        if (prev && people.length) prev.people = prev.people.concat(people);
        continue;
      }
      const range = clean(rawDate) || rawDate instanceof Date || typeof rawDate === 'number' ? dateRange(rawDate, year) : null;
      const label = (opts.label ? opts.label + ' ' : '') + '第 ' + (r + 1) + ' 列';
      const uncertain = [];
      if (!range) uncertain.push(clean(rawDate) ? '日期看不懂：「' + clean(rawDate) + '」' + (year ? '' : '（表上沒有年份的話，請在上面填年份）') : '沒有日期');
      const t = c.time !== -1 ? timeRange(row[c.time]) : { start: '', end: '' };
      const t2 = c.endTime !== -1 ? timeRange(row[c.endTime]) : null;
      const catText = c.cat !== -1 ? key(row[c.cat]) : '';
      const s = {
        name: name || (prev ? prev.name : ''),
        category: CATS.indexOf(catText) !== -1 ? catText : '',
        nature: CATS.indexOf(catText) === -1 ? catText : '',
        date: range ? range.start : '', end: range ? range.end : '',
        startTime: t.start, endTime: (t2 && t2.start) || t.end,
        location: c.location !== -1 ? clean(row[c.location]).slice(0, 40) : '',
        people, uncertain, source: label, byTable: true
      };
      if (!s.name) { problems.push(label + '：沒有名稱'); continue; }
      out.push(s);
      prev = s;
    }
    return { header: true, sessions: out, problems };
  }

  /** 同名、同一天、同類別的合成一場（不同表格、不同批讀到同一場時），名字不重複 */
  function mergeSame(list) {
    const map = new Map();
    const out = [];
    list.forEach((s) => {
      const k = s.date ? key(s.name) + '|' + s.date + '|' + (s.category || '') : null;
      const into = k && map.get(k);
      if (!into) { const x = Object.assign({}, s, { people: s.people.slice(), uncertain: (s.uncertain || []).slice() }); if (k) map.set(k, x); out.push(x); return; }
      s.people.forEach((p) => { if (!into.people.some((q) => q.name === p.name)) into.people.push(p); });
      (s.uncertain || []).forEach((u) => { if (into.uncertain.indexOf(u) === -1) into.uncertain.push(u); });
      ['startTime', 'endTime', 'location', 'end'].forEach((f) => { if (!into[f] && s[f]) into[f] = s[f]; });
      if (!into.byTable || !s.byTable) into.byTable = false;
    });
    return out;
  }

  const api = { yearOf, oneDate, dateRange, timeRange, peopleOf, findHeader, parseTable, mergeSame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OldParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
