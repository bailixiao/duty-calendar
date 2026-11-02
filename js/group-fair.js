// 新增勤務時「建議負責組」：同一分組類型的各組，依近一年（今天往前 365 天）到之後已排的勤務筆數排序，
// 負責得最少、最久沒輪到的排前面；當天已經有勤務的組排最後。純計算，Node 測試也用。
(function () {
  'use strict';

  /**
   * names：這個分組類型的組名；duties：勤務列表（groupType, group, start, end, id）；
   * date：這筆勤務的日期（可空白）；selfId：編輯中的這筆（不算進去）；today：今天。
   * 回傳 [{ name, count, last, busy }]，第一個就是建議的組。
   */
  function rank(names, type, duties, date, selfId, today) {
    const from = Fmt.addDays(today, -364);
    const stat = {};
    names.forEach((n, i) => { stat[n] = { name: n, count: 0, last: '', busy: false, order: i }; });
    duties.forEach((d) => {
      const g = stat[d.group];
      if (!g || d.groupType !== type || (selfId && d.id === selfId)) return;
      const end = d.end || d.start;
      if (date && d.start <= date && end >= date) g.busy = true;
      if (end < from) return;
      g.count++;
      if (d.start > g.last) g.last = d.start;
    });
    return names.map((n) => stat[n]).sort((a, b) =>
      (a.busy - b.busy) || (a.count - b.count) || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0) || (a.order - b.order)
    ).map(({ name, count, last, busy }) => ({ name, count, last, busy }));
  }

  const api = { rank };
  if (typeof module !== 'undefined') module.exports = api;
  else window.GroupFair = api;
})();
