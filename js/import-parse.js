// 批次匯入：把從 Excel／Google 試算表複製的多列（以 Tab 分隔）轉成勤務資料（規格第 8 節管理者後台第 3 項）。
// 純函式，不碰畫面；瀏覽器用 window.ImportParse，Node 測試用 module.exports（tests/import-parse.test.js）。
//
// 欄位順序：日期、名稱、時段、地點、負責組、了愿項目、模式、性質、服裝、說明（後面幾欄可省略）
//   日期     115/10/18、2026-10-18；多天：115/11/8-115/11/15、115/11/8~11/15
//   時段     08:00-12:00、8:00、21:00-08:00（到隔天）
//   負責組   打掃組 第1組（分組類型＋組名）；組名只屬於一種分組類型時可以只寫組名
//   了愿項目 用「、」分隔：「烹飪 4」＝最少最多都是 4；「清潔 2-4」＝最少 2 最多 4；「志工 2+」＝最少 2 不限；只寫名稱＝不限
//   模式     空白＝報名型；性質 空白＝勤務
(function () {
  'use strict';

  const COLUMNS = ['日期', '名稱', '時段', '地點', '負責組', '了愿項目', '模式', '性質', '服裝', '說明'];
  const GROUP_TYPES = ['勤務了愿組', '打掃組', '拜香輪值組'];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function validDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** 一個日期：115/10/18、2026/10/18、2026-10-18；沒寫年就用 baseYear。回傳 'yyyy-MM-dd' 或 null */
  function parseOneDate(text, baseYear) {
    const parts = String(text).trim().split(/[/\-.]/).map((x) => x.trim());
    if (parts.some((x) => !/^\d+$/.test(x))) return null;
    let y;
    let m;
    let d;
    if (parts.length === 3) [y, m, d] = parts.map(Number);
    else if (parts.length === 2 && baseYear) { y = baseYear; [m, d] = parts.map(Number); } else return null;
    if (y < 1911) y += 1911; // 民國年
    if (!validDate(y, m, d)) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** 日期欄：單日或區間。回傳 { start, end } 或 { error } */
  function parseDates(text) {
    const s = String(text || '').trim().replace(/\s+/g, ' ');
    if (!s) return { error: '沒有日期' };
    let a = s;
    let b = '';
    const tilde = s.split(/\s*[~～至到]\s*/);
    if (tilde.length === 2) [a, b] = tilde;
    else if (/\//.test(s) && s.split('-').length === 2) [a, b] = s.split('-'); // 115/11/8-115/11/15（斜線日期才用 - 當區間）
    else if (/ - /.test(s)) [a, b] = s.split(' - ');
    const start = parseOneDate(a);
    if (!start) return { error: `看不懂日期「${s}」` };
    if (!b) return { start, end: start };
    let end = parseOneDate(b, Number(start.slice(0, 4)));
    if (end && end < start && b.split(/[/\-.]/).length === 2) end = parseOneDate(b, Number(start.slice(0, 4)) + 1); // 跨年沒寫年
    if (!end) return { error: `看不懂結束日「${b}」` };
    if (end < start) return { error: '結束日早於開始日' };
    return { start, end };
  }

  function parseTime(t) {
    const m = /^(\d{1,2})[:：](\d{2})$/.exec(String(t).trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return `${pad(m[1])}:${m[2]}`;
  }

  /** 時段欄：08:00-12:00、8:00、空白。回傳 { startTime, endTime } 或 { error } */
  function parseTimes(text) {
    const s = String(text || '').trim();
    if (!s) return { startTime: '', endTime: '' };
    const parts = s.split(/\s*[-~～–至到]\s*/);
    const startTime = parseTime(parts[0]);
    const endTime = parts[1] ? parseTime(parts[1]) : '';
    if (!startTime || endTime === null || parts.length > 2) return { error: `看不懂時段「${s}」，請用 08:00-12:00` };
    return { startTime, endTime };
  }

  /** 負責組欄。groups = [{ type, name }]。回傳 { groupType, group } 或 { error } */
  function parseGroup(text, groups) {
    const s = String(text || '').trim();
    if (!s) return { groupType: '', group: '' };
    const type = GROUP_TYPES.find((t) => s.indexOf(t) === 0);
    if (type) {
      const name = s.slice(type.length).replace(/^[\s／/:：|｜]+/, '').trim();
      if (!name) return { error: `「${type}」後面要寫組名` };
      if (!groups.some((g) => g.type === type && g.name === name)) return { error: `「${type}」沒有「${name}」這一組` };
      return { groupType: type, group: name };
    }
    const matches = groups.filter((g) => g.name === s);
    if (matches.length === 1) return { groupType: matches[0].type, group: s };
    if (matches.length > 1) return { error: `「${s}」在好幾種分組都有，請寫成「${matches[0].type} ${s}」` };
    return { error: `找不到負責組「${s}」` };
  }

  /** 了愿項目欄。回傳 { positions } 或 { error } */
  function parsePositions(text) {
    const s = String(text || '').trim();
    if (!s) return { positions: [] };
    const positions = [];
    for (const raw of s.split(/[、，,;；\n]/)) {
      const item = raw.trim();
      if (!item) continue;
      const m = /^(.*?)\s*(\d+)\s*(?:[-~～–]\s*(\d+)|(\+))?\s*人?$/.exec(item);
      if (!m || !m[1].trim()) {
        positions.push({ name: item, slot: '', min: '', max: '' });
        continue;
      }
      const name = m[1].trim();
      const a = m[2];
      if (m[3]) positions.push({ name, slot: '', min: a, max: m[3] });
      else if (m[4]) positions.push({ name, slot: '', min: a, max: '' });
      else positions.push({ name, slot: '', min: a, max: a });
    }
    return { positions };
  }

  /**
   * 解析整段貼上的文字。第一列若是欄位名稱（以「日期」開頭）會略過，空白列略過。
   * 回傳 [{ line, cells, duty, errors }]，duty 為送給 adminCreateDuties 的格式。
   */
  function parse(text, groups) {
    const rows = [];
    String(text || '').split(/\r?\n/).forEach((lineText, i) => {
      if (!lineText.trim()) return;
      const cells = lineText.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (i === 0 && cells[0] === '日期') return;
      const errors = [];
      const take = (r) => { if (r.error) errors.push(r.error); return r; };
      const dates = take(parseDates(cells[0]));
      const name = cells[1] || '';
      if (!name) errors.push('沒有名稱');
      const times = take(parseTimes(cells[2]));
      const group = take(parseGroup(cells[4], groups || []));
      const pos = take(parsePositions(cells[5]));
      const mode = cells[6] || '報名型';
      if (['報名型', '公告型'].indexOf(mode) === -1) errors.push('模式只能是報名型或公告型');
      const nature = cells[7] || '勤務';
      if (['勤務', '支援', '烹飪', '活動'].indexOf(nature) === -1) errors.push('性質只能是勤務、支援、烹飪或活動');
      if (mode === '報名型' && !errors.length && !pos.positions.length) errors.push('報名型要寫了愿項目，例如「志工 2」');
      if (mode === '公告型' && !group.group && !errors.length) errors.push('公告型要寫負責組');
      if (cells.length > COLUMNS.length) errors.push(`欄位太多（最多 ${COLUMNS.length} 欄），說明裡不能有 Tab`);
      rows.push({
        line: i + 1,
        cells,
        errors,
        duty: errors.length ? null : {
          name, nature, mode, start: dates.start, end: dates.end,
          startTime: times.startTime, endTime: times.endTime, location: cells[3] || '',
          groupType: group.groupType, group: group.group,
          attire: cells[8] || '', description: cells[9] || '',
          positions: mode === '公告型' ? [] : pos.positions
        }
      });
    });
    return rows;
  }

  const api = { COLUMNS, parse, parseDates, parseTimes, parseGroup, parsePositions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.ImportParse = api;
})();
