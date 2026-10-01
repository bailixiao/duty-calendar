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
  function effectiveMin(p) {
    if (p.min !== null && p.min !== undefined) return p.min;
    return p.max !== null && p.max !== undefined ? Math.min(DEFAULT_MIN_PEOPLE, p.max) : DEFAULT_MIN_PEOPLE;
  }

  /**
   * 某勤務某天的狀態。
   * kind：notice（公告型）| full（額滿）| short（缺人，含不到預設 2 人）| ok（人數足）
   */
  function dayState(duty, day) {
    if (duty.mode === '公告型') {
      return { kind: 'notice', label: duty.group ? `輪值：${duty.group}` : '公告' };
    }
    const d = day || { total: 0, shortage: 0, full: false, counts: {} };
    const counts = d.counts || {};
    const shortage = duty.positions.reduce((sum, p) => sum + Math.max(effectiveMin(p) - (counts[p.id] || 0), 0), 0);
    if (d.full) return { kind: 'full', label: '額滿' };
    if (shortage > 0) return { kind: 'short', label: `缺 ${shortage} 人` };
    const unlimited = duty.positions.every((p) => p.max === null);
    return { kind: 'ok', label: unlimited ? `已報 ${d.total} 人` : `人數足・${d.total} 人` };
  }

  /** 卡片上顯示的負責組與組長或召集人（12人小組不顯示，規格第 4 節） */
  function groupText(duty) {
    if (duty.mode === '公告型') return duty.groupLeader ? `組長：${duty.groupLeader}` : ''; // 輪值組已在標籤上
    if (!duty.group || duty.name.indexOf('12人小組') !== -1) return '';
    return `負責：${duty.group}${duty.groupLeader ? `（${duty.groupLeader}）` : ''}`;
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

  window.Fmt = {
    esc, toDateStr, parseDate, addDays, datesBetween, rocYear, weekday, shortDate, rocDate,
    timeRange, cardTime, effectiveMin, dayState, groupText, setContact, askAdmin
  };
})();
