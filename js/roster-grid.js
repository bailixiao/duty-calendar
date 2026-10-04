// 職司表（12人小組這類多天輪值）：階段時間軸與「一欄一天、一列一個了愿項目」的表格資料。
// 純函式，不碰畫面；瀏覽器用 window.RosterGrid，Node 測試用 module.exports。
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function addDays(s, n) {
    const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + n));
    return d.toISOString().slice(0, 10);
  }

  function datesBetween(a, b) {
    const out = [];
    for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }

  /** 「9/14」→ yyyy-MM-dd：年份跟著勤務的開始日；差超過半年就算前一年或後一年（跨年的階段） */
  function toDate(m, d, start) {
    const sy = Number(start.slice(0, 4));
    const sm = Number(start.slice(5, 7));
    const y = m - sm > 6 ? sy - 1 : sm - m > 6 ? sy + 1 : sy;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /**
   * 階段文字（一行一個，「日期｜說明」）→ [{ n, when, text, from, to, state }]
   * 日期可寫「9/14~9/18」「即日起~9/13」「9/21(一)」「10/1起」；from、to 為 null 代表不限。
   * state：done（已過）、now（現在這個階段；今天不在任何階段時，亮下一個）、todo
   */
  function parseStages(text, start, today) {
    const lines = String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const stages = lines.map((line, i) => {
      const m = line.match(/^(.*?)[｜|](.*)$/);
      const when = m ? m[1].trim() : '';
      const desc = m ? m[2].trim() : line;
      const ds = [...when.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})/g)].map((x) => toDate(Number(x[1]), Number(x[2]), start));
      let from = null;
      let to = null;
      if (ds.length >= 2) { from = ds[0]; to = ds[ds.length - 1]; }
      else if (ds.length === 1) {
        if (/即日|以前|之前|前$/.test(when)) to = ds[0];
        else if (/起$|以後|之後/.test(when)) from = ds[0];
        else { from = ds[0]; to = ds[0]; }
      }
      return { n: i + 1, when, text: desc, from, to, dated: ds.length > 0, state: 'todo' };
    });
    const dated = stages.filter((s) => s.dated);
    let now = dated.find((s) => (!s.from || s.from <= today) && (!s.to || today <= s.to));
    if (!now) now = dated.find((s) => s.from && s.from > today);
    stages.forEach((s) => {
      if (s === now) s.state = 'now';
      else if (s.dated && s.to && s.to < today) s.state = 'done';
    });
    return stages;
  }

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdayOf = (s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))).getUTCDay();
  const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

  /**
   * 「階段」留空時自動推算（12人小組的節奏，教全區三個階段）：
   *   ③ 壇辦班職司最後調整：輪值第一天之前的禮拜一（壇辦班都在禮拜一）
   *   ② 職司安排：再前一週的禮拜一～禮拜五
   *   ① 報名了愿日期：③ 往前三週的禮拜一～職司安排前一天（禮拜日）
   * 例：11/8 開始 → 10/12~10/25、10/26~10/30、11/2(一)
   */
  function autoStages(start) {
    let adjust = addDays(start, -1);
    while (weekdayOf(adjust) !== 1) adjust = addDays(adjust, -1);
    const arrange = [addDays(adjust, -7), addDays(adjust, -3)];
    const signup = [addDays(adjust, -21), addDays(adjust, -8)];
    return [
      `${md(signup[0])}~${md(signup[1])}｜報名了愿日期`,
      `${md(arrange[0])}~${md(arrange[1])}｜職司安排`,
      `${md(adjust)}(${WEEK[weekdayOf(adjust)]})｜壇辦班職司最後調整`
    ].join('\n');
  }

  /** 勤務要顯示的階段文字：有填就用填的，留空就自動推算 */
  function stagesText(duty) {
    return String(duty.stages || '').trim() || autoStages(duty.start);
  }

  /**
   * 職司表資料：{ dates: [{ date, total, today }], groups: [{ position, rows, cells: { date: [報名] } }] }
   * 每格裡組長排最前面，其餘照報名順序；列數＝這個項目人最多的那天（至少 1 列）。
   * total：當天不含陪同的人數。
   */
  function build(duty) {
    const signups = duty.signups || [];
    const dates = datesBetween(duty.start, duty.end || duty.start).map((date) => ({
      date,
      total: signups.filter((s) => s.date === date && !s.accompany).length,
      today: date === duty.today
    }));
    const groups = duty.positions.map((p) => {
      const cells = {};
      let rows = 1;
      dates.forEach(({ date }) => {
        const people = signups.filter((s) => s.date === date && s.positionId === p.id);
        const list = people.filter((s) => s.leader).concat(people.filter((s) => !s.leader));
        cells[date] = list;
        rows = Math.max(rows, list.length);
      });
      return { position: p, rows, cells };
    });
    return { dates, groups };
  }

  const api = { parseStages, build, datesBetween, autoStages, stagesText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RosterGrid = api;
})();
