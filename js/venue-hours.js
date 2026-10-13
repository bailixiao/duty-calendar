// 場地借用的時間（2026/10/13 起按小時借，07:00～22:00 一小時一格）。
// 時段存成開始的整點（例：'09:00' ＝ 09:00～10:00）；以前的「早上／下午／晚上」換算成它包含的小時。
// 純函式；瀏覽器用 window.VenueHours，Node 測試用 module.exports。後端 Venue.gs 有一樣的規則。
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const HOURS = [];
  for (let h = 7; h <= 21; h++) HOURS.push(pad(h) + ':00');
  const LEGACY = { 早上: ['08:00', '09:00', '10:00', '11:00'], 下午: ['13:00', '14:00', '15:00', '16:00'], 晚上: ['18:00', '19:00', '20:00'] };

  /** 某個時段包含的小時（舊的早上／下午／晚上換算） */
  function hoursOf(slot) {
    return LEGACY[slot] || (HOURS.indexOf(slot) !== -1 ? [slot] : []);
  }

  /** 'HH:00' 的下一個整點 */
  function next(h) {
    return pad(Number(h.slice(0, 2)) + 1) + ':00';
  }

  /** 好幾個時段 → 連續的合成一段：['09:00','10:00','11:00','14:00'] → '09:00～12:00、14:00～15:00' */
  function label(slots) {
    const hours = [...new Set([].concat(...(slots || []).map(hoursOf)))].sort();
    const out = [];
    hours.forEach((h) => {
      const last = out[out.length - 1];
      if (last && last[1] === h) last[1] = next(h);
      else out.push([h, next(h)]);
    });
    return out.map(([a, b]) => `${a}～${b}`).join('、');
  }

  /** 兩組時段有沒有重疊 */
  function overlaps(a, b) {
    const set = new Set([].concat(...a.map(hoursOf)));
    return [].concat(...b.map(hoursOf)).some((h) => set.has(h));
  }

  const api = { HOURS, LEGACY, hoursOf, next, label, overlaps };
  if (typeof module !== 'undefined') module.exports = api;
  else window.VenueHours = api;
})();
