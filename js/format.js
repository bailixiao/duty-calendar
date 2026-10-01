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

  /** 是否為「只有一個了愿項目且不限人數」的勤務（打掃、割草等），只顯示已報人數 */
  function isOpenCount(duty) {
    return duty.positions.length === 1 && duty.positions[0].min === null && duty.positions[0].max === null;
  }

  /**
   * 某勤務某天的狀態。
   * kind：notice（公告型）| full（額滿）| short（缺人）| ok（人數足或不限人數）
   */
  function dayState(duty, day) {
    if (duty.mode === '公告型') {
      return { kind: 'notice', label: duty.group ? `輪值：${duty.group}` : '公告' };
    }
    const d = day || { total: 0, shortage: 0, full: false };
    if (isOpenCount(duty)) return { kind: 'ok', label: `已報 ${d.total} 人` };
    if (d.full) return { kind: 'full', label: '額滿' };
    if (d.shortage > 0) return { kind: 'short', label: `缺 ${d.shortage} 人` };
    // 沒有最少人數要求的勤務，不說「人數足」，只顯示已報人數（有上限時顯示 N／上限）
    if (duty.positions.every((p) => p.min === null)) {
      const capped = duty.positions.length > 0 && duty.positions.every((p) => p.max !== null);
      const cap = capped ? duty.positions.reduce((sum, p) => sum + p.max, 0) : null;
      return { kind: 'ok', label: cap === null ? `已報 ${d.total} 人` : `已報 ${d.total}／${cap} 人` };
    }
    return { kind: 'ok', label: `人數足・${d.total} 人` };
  }

  /** 卡片上顯示的負責組（12人小組不顯示，規格第 4 節） */
  function groupText(duty) {
    if (!duty.group || duty.mode === '公告型' || duty.name.indexOf('12人小組') !== -1) return '';
    return `負責：${duty.group}`;
  }

  window.Fmt = {
    esc, toDateStr, parseDate, addDays, datesBetween, rocYear, weekday, shortDate, rocDate,
    timeRange, cardTime, isOpenCount, dayState, groupText
  };
})();
