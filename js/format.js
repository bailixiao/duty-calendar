// 日期、時間、人數狀態的顯示格式，以及共用小工具。
(function () {
  'use strict';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Date → 'yyyy-MM-dd'（用瀏覽器本地日期） */
  function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** 'yyyy-MM-dd' → 本地午夜的 Date */
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function datesBetween(start, end) {
    const out = [];
    for (let s = start; s <= end; s = addDays(s, 1)) out.push(s);
    return out;
  }

  function rocYear(s) {
    return Number(s.slice(0, 4)) - 1911;
  }

  function weekday(s) {
    return WEEKDAYS[parseDate(s).getDay()];
  }

  /** '2026-10-10' → '10/10（六）' */
  function shortDate(s) {
    return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}（${weekday(s)}）`;
  }

  /** '2026-10-10' → '115/10/10（六）' */
  function rocDate(s) {
    return `${rocYear(s)}/${shortDate(s)}`;
  }

  /** 勤務時段文字；跨日單日勤務顯示「隔天」 */
  /** 類別標籤上的字：勤務類寫「總務・勤務」，道務、教育照原樣 */
  function catLabel(category) {
    const c = category || '勤務';
    const labels = (window.SITE && window.SITE.categoryLabels) || {};
    return labels[c] || c;
  }

  function timeRange(duty) {
    const { start, end, startTime, endTime } = duty;
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
    if (start !== end) {
      const a = md(start) + (startTime ? ' ' + startTime : '');
      const b = md(end) + (endTime ? ' ' + endTime : '');
      return `${a} – ${b}`;
    }
    if (startTime && endTime) {
      return endTime <= startTime ? `${startTime} – 隔天 ${endTime}` : `${startTime} – ${endTime}`;
    }
    return startTime || '';
  }

  /**
   * 卡片上某一天的時段（精簡版）。
   * 單日勤務：同 timeRange；多天勤務：「第 3／8 天」，第一天加「14:00 起」、最後一天加「至 14:00」。
   */
  function cardTime(duty, date) {
    if (duty.start === duty.end) return timeRange(duty);
    const total = datesBetween(duty.start, duty.end).length;
    const n = datesBetween(duty.start, date).length;
    let text = `第 ${n}／${total} 天`;
    if (date === duty.start && duty.startTime) text += ` ${duty.startTime} 起`;
    if (date === duty.end && duty.endTime) text += ` 至 ${duty.endTime}`;
    return text;
  }

  /** 「最少」留空時預設 2 人；「最多」小於 2 時以最多為準（與後端 Rules.gs effectiveMin_ 相同） */
  const DEFAULT_MIN_PEOPLE = 2;
  /**
   * 勤務管理「依項目」看（2026/11/27）：同一種的名稱。去掉開頭的農曆日期（十一月初一拜香輪值 → 拜香輪值），
   * 括號裡的地點保留（初一十五打掃（宏宗）和（區中心）是不同組）。
   */
  function seriesName(name) {
    return String(name || '')
      .replace(/^閏?[正一二三四五六七八九十冬臘腊]{1,2}月(初[一二三四五六七八九十]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|廿[一二三四五六七八九]?|三十)/, '')
      .replace(/^[\s　]+|[\s　]+$/g, '') || String(name || '');
  }

  /**
   * 照項目分組：items 照原本的順序（日期）；回傳 [{ name, items, next, cancelled }]，
   * next＝今天（含）以後最近的一筆日期（沒有就是最後一筆）；組的順序照 next（還有之後的排前面）。
   */
  function groupSeries(items, today) {
    const map = new Map();
    items.forEach((d) => {
      const k = seriesName(d.name);
      if (!map.has(k)) map.set(k, { name: k, items: [], next: '', cancelled: 0 });
      const g = map.get(k);
      g.items.push(d);
      if (d.cancelled) g.cancelled += 1;
    });
    const groups = [...map.values()];
    groups.forEach((g) => {
      const up = g.items.filter((d) => (d.end || d.start) >= today).map((d) => d.start).sort();
      g.upcoming = up.length;
      g.next = up.length ? up[0] : g.items.map((d) => d.start).sort().pop();
    });
    return groups.sort((a, b) => (b.upcoming > 0) - (a.upcoming > 0) || (a.upcoming ? (a.next < b.next ? -1 : a.next > b.next ? 1 : 0) : (a.next > b.next ? -1 : a.next < b.next ? 1 : 0)) || a.name.localeCompare(b.name, 'zh-Hant'));
  }

  /** 停課的字：教育、道務的課程寫「停課」，其他（勤務、活動）寫「取消」 */
  function cancelLabel(duty) {
    return duty && (duty.category === '教育' || duty.nature === '課程') ? '停課' : '取消';
  }

  function effectiveMin(p) {
    if (p.min !== null && p.min !== undefined) return p.min;
    return p.max !== null && p.max !== undefined ? Math.min(DEFAULT_MIN_PEOPLE, p.max) : DEFAULT_MIN_PEOPLE;
  }

  /**
   * 某勤務某天的狀態。
   * kind：cancelled（停課）| notice（公告型）| full（額滿）| short（缺人，含不到預設 2 人）| ok（人數足）
   */
  function dayState(duty, day) {
    if (duty.cancelled) return { kind: 'cancelled', label: cancelLabel(duty) }; // 停課（2026/11/27）
    if (duty.mode === '公告型') {
      return { kind: 'notice', label: duty.group ? `輪值：${duty.group}` : '公告' };
    }
    const d = day || { total: 0, shortage: 0, full: false, counts: {} };
    const counts = d.counts || {};
    if (duty.category === '道務' || duty.category === '教育') { // 自由參加、鼓勵為主：不算缺人
      return d.full ? { kind: 'full', label: '額滿' } : { kind: 'ok', label: `已報 ${d.total} 人` };
    }
    // 可兼任且有填共需人數：缺幾人＝共需人數－不重複人數；沒填照各項目最少人數
    const shortage = duty.totalNeed
      ? Math.max(duty.totalNeed - (d.people !== undefined ? d.people : d.total), 0)
      : duty.positions.reduce((sum, p) => sum + Math.max(effectiveMin(p) - (counts[p.id] || 0), 0), 0);
    if (d.full) return { kind: 'full', label: '額滿' };
    if (shortage > 0) return { kind: 'short', label: `缺 ${shortage} 人` };
    const unlimited = duty.positions.every((p) => p.max === null);
    return { kind: 'ok', label: unlimited ? `已報 ${d.total} 人` : `人數足・${d.total} 人` };
  }

  /** 卡片上顯示的負責組與組長或召集人（12人小組不顯示，規格第 4 節） */
  /** 負責組可以好幾組，用「、」隔開（例：第1組、第3組，2026/11/19）；回傳組名陣列 */
  function groupNames(text) {
    return String(text || '').split('、').map((x) => x.trim()).filter(Boolean);
  }

  /** 負責組的帶頭人怎麼稱呼：打掃組叫「召集人」，其他叫「組長」 */
  function leaderWord(groupType) {
    return groupType === '打掃組' ? '召集人' : '組長';
  }

  /** 登記張數的勤務：這幾筆報名一共幾張（沒記張數的算 1 張） */
  function ticketSum(signups) {
    return signups.reduce((n, s) => n + (Number(s.tickets) || 1), 0);
  }

  /** 登記張數的名單：依佛堂分組（照第一次出現的順序，沒填佛堂的放最後），每組有小計張數 */
  function ticketGroups(signups) {
    const map = new Map();
    signups.forEach((x) => {
      const k = x.temple || '';
      if (!map.has(k)) map.set(k, { temple: k, people: [], sum: 0 });
      const g = map.get(k);
      g.people.push(x);
      g.sum += Number(x.tickets) || 1;
    });
    return [...map.values()].sort((a, b) => (a.temple ? 0 : 1) - (b.temple ? 0 : 1));
  }

  function groupText(duty) {
    if (duty.mode === '公告型') return duty.groupLeader ? `${leaderWord(duty.groupType)}：${duty.groupLeader}` : ''; // 輪值組已在標籤上
    if (!duty.group || duty.name.indexOf('12人小組') !== -1) return '';
    return `負責：${duty.group}${duty.groupLeader ? `（${duty.groupLeader}）` : ''}`;
  }

  /**
   * 兩個名字是否視為同一人（與後端 Rules.gs sameName_ 相同）：
   * 三個字以上先去掉第一個字（姓），剩下的部分只要有連續兩個字相同就算同一人。
   */
  function sameName(a, b) {
    const clean = (s) => String(s || '').replace(/[\s　]/g, '');
    const keys = (n) => {
      const s = n.length >= 3 ? n.slice(1) : n;
      const out = [];
      for (let i = 0; i + 1 < s.length; i++) out.push(s.substr(i, 2));
      return out;
    };
    a = clean(a);
    b = clean(b);
    if (!a || !b) return false;
    if (a === b) return true;
    const kb = keys(b);
    return keys(a).some((k) => kb.indexOf(k) !== -1);
  }

  /** 名字排序：依筆劃（姓的筆劃少到多），各裝置一致（不依賴瀏覽器預設的中文排序） */
  const strokeCollator = new Intl.Collator('zh-Hant-TW-u-co-stroke');
  function byStroke(a, b) {
    return strokeCollator.compare(a, b);
  }

  // 管理者聯絡人：伺服器從指令碼屬性 ADMIN_CONTACT 讀出、隨資料傳來（程式碼裡不放人名）
  let contact = '';
  function setContact(name) {
    if (typeof name === 'string') contact = name;
  }
  /** 「請聯絡管理者○○○」 */
  function askAdmin() {
    return '請聯絡管理者' + contact;
  }

  /** 缺人日期一串：超過 max 天只列前面幾天＋「⋯等 N 天」 */
  function shortDateList(dates, max) {
    const list = [...dates];
    const n = max || 8;
    return list.slice(0, n).map(shortDate).join('、') + (list.length > n ? `⋯等 ${list.length} 天` : '');
  }

  /**
   * 打字的時間換成 HH:MM（2026/11/21）：0830、830、8:30、8.30、8點30、8點半、21:45、下午9:45、晚上9點 都可以；
   * 空白回傳 ''，看不懂回傳 null。
   */
  function parseTime(text) {
    let t = String(text || '').trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':').replace(/\s+/g, '');
    if (!t) return '';
    let pm = false;
    let am = false;
    const pre = t.match(/^(上午|早上|凌晨|中午|下午|晚上|傍晚|am|pm)/i);
    if (pre) {
      pm = /下午|晚上|傍晚|pm/i.test(pre[1]);
      am = /上午|早上|凌晨|am/i.test(pre[1]);
      t = t.slice(pre[1].length);
    }
    const post = t.match(/(am|pm)$/i);
    if (post) { pm = /pm/i.test(post[1]); am = !pm; t = t.slice(0, -2); }
    let h;
    let m;
    let x;
    if ((x = t.match(/^(\d{1,2})[:.點時](\d{1,2})?分?$/))) { h = +x[1]; m = x[2] ? +x[2] : 0; }
    else if ((x = t.match(/^(\d{1,2})點半$/))) { h = +x[1]; m = 30; }
    else if ((x = t.match(/^(\d{3,4})$/))) { h = +x[1].slice(0, -2); m = +x[1].slice(-2); }
    else if ((x = t.match(/^(\d{1,2})$/))) { h = +x[1]; m = 0; }
    else return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  window.Fmt = {
    parseTime,
    esc, toDateStr, parseDate, addDays, datesBetween, rocYear, weekday, shortDate, rocDate, catLabel,
    timeRange, cardTime, effectiveMin, dayState, cancelLabel, seriesName, groupSeries, groupText, groupNames, leaderWord, ticketSum, ticketGroups, sameName, byStroke, setContact, askAdmin, shortDateList
  };
})();
