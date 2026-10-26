// 後台「📢 總務佈達」：初一、十五的打掃輪值（各地點的負責組、召集人）和拜香輪值（組別、組長）自動整理成一段文字，
// 選日期後可以複製或傳到 LINE（資料來自勤務的負責組與後台分組的組長或召集人）。
(function () {
  'use strict';

  const ZH = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const PLACE_ORDER = ['宏宗', '區中心', '母殿'];

  /** 「第2組」→「第二組」（和平常布達的寫法一樣） */
  function zhGroup(g) {
    return String(g || '').replace(/第(\d{1,2})組/g, (m, n) => (ZH[Number(n)] ? `第${ZH[Number(n)]}組` : m));
  }

  /** 打掃的地點：名稱括號裡的字（初一十五打掃（區中心）→ 區中心），彌勒山母殿寫成母殿 */
  function placeOf(d) {
    const m = String(d.name).match(/[（(]([^）)]+)[）)]/);
    return (m ? m[1] : d.location || d.name).replace(/^彌勒山(?=母殿)/, '');
  }

  const covers = (d, date) => d.start <= date && (d.end || d.start) >= date;
  const isCleaning = (d) => d.groupType === '打掃組' && /打掃/.test(d.name);
  const isIncense = (d) => d.groupType === '拜香輪值組' || /拜香輪值/.test(d.name);

  /** 有打掃輪值或拜香輪值的日期（排序、不重複） */
  function datesOf(duties, from) {
    const set = new Set();
    duties.filter((d) => isCleaning(d) || isIncense(d)).forEach((d) => {
      Fmt.datesBetween(d.start, d.end || d.start).forEach((x) => { if (x >= from) set.add(x); });
    });
    return [...set].sort();
  }

  /** 佈達文字（純計算，Node 測試也用）；lunar＝{ full: '十月初一' } */
  function text(date, duties, lunar) {
    const day = duties.filter((d) => covers(d, date));
    const p = date.split('-').map(Number);
    const lines = ['總務佈達🎉🎉🎉', `農曆${lunar.full}`, `（國曆${p[1]}月${p[2]}日星期${Fmt.weekday(date)}）`];
    const clean = day.filter(isCleaning).sort((a, b) => {
      const ia = PLACE_ORDER.indexOf(placeOf(a));
      const ib = PLACE_ORDER.indexOf(placeOf(b));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name, 'zh-Hant');
    });
    if (clean.length) {
      lines.push('🧹佛堂打掃-打掃輪值');
      clean.forEach((d) => {
        lines.push(`(⭐️)${placeOf(d)} ${zhGroup(d.group) || '（還沒排組）'}`);
        if (d.groupLeader) lines.push(`召集人：${d.groupLeader}`);
      });
    }
    const incense = day.filter((d) => isIncense(d) && !isCleaning(d));
    if (incense.length) {
      lines.push('🛐拜香輪值');
      incense.forEach((d) => lines.push(`${zhGroup(d.group) || '（還沒排組）'}${d.groupLeader ? ` 組長：${d.groupLeader}` : ''}`));
    }
    if (!clean.length && !incense.length) lines.push('（這一天沒有打掃輪值或拜香輪值）');
    return lines.join('\n');
  }

  /** 打開佈達視窗：讀今天起 60 天的勤務，預設最近的一天 */
  async function open() {
    const today = Fmt.toDateStr(new Date());
    const m = Modal.open(`
      <h2 class="modal-title">📢 總務佈達</h2>
      <p class="modal-note">初一、十五的打掃輪值和拜香輪值，自動整理好，可以直接貼到 LINE。</p>
      <div data-notice-body><p class="muted">整理中⋯</p></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-copy disabled>複製佈達</button>
        <button type="button" class="btn btn-line btn-block" data-line disabled>傳到 LINE</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.classList.add('modal-wide');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const body = m.el.querySelector('[data-notice-body]');
    let duties;
    try {
      duties = (await Api.getEvents(today, Fmt.addDays(today, 60))).duties;
    } catch (err) {
      body.innerHTML = `<p class="form-error">${Fmt.esc(err.message || '讀不到勤務')}</p>`;
      return;
    }
    const dates = datesOf(duties, today);
    if (!dates.length) { body.innerHTML = '<p class="muted">60 天內沒有打掃輪值或拜香輪值。</p>'; return; }
    body.innerHTML = `
      <label class="form-row"><span>日期</span>
        <select class="input" data-date>${dates.map((d) => `<option value="${d}">${Fmt.esc(Fmt.shortDate(d))}　農曆${Fmt.esc(LunarUtil.lunarOf(d).full)}</option>`).join('')}</select></label>
      <textarea class="day-text" rows="14" data-text aria-label="佈達文字（可以修改）"></textarea>
      <p class="hint">可以先在框裡修改再複製。組別、召集人來自勤務的「負責組」和後台「分組」的組長或召集人，不對的話到那邊改。</p>`;
    const sel = body.querySelector('[data-date]');
    const area = body.querySelector('[data-text]');
    const fill = () => { area.value = text(sel.value, duties, LunarUtil.lunarOf(sel.value)); };
    sel.addEventListener('change', fill);
    fill();
    const copy = m.el.querySelector('[data-copy]');
    const line = m.el.querySelector('[data-line]');
    copy.disabled = false;
    line.disabled = false;
    copy.addEventListener('click', async () => {
      copy.textContent = (await Share.copyText(area.value)) ? '已複製 ✓' : '複製失敗';
      setTimeout(() => { copy.textContent = '複製佈達'; }, 2500);
    });
    line.addEventListener('click', () => window.open('https://line.me/R/msg/text/?' + encodeURIComponent(area.value), '_blank', 'noopener'));
  }

  const api = { open, text, datesOf, zhGroup, placeOf };
  if (typeof module !== 'undefined') module.exports = api;
  else window.GeneralNotice = api;
})();
