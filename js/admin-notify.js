// 後台「📢 通知」的「📣 佈達」：選總務／道務／教育（總管理者可以選，類別帳號固定自己的），列出今天起一年內的項目，
// 勾選後產生佈達文字（同「複製通知」，見 share.js inviteText），可以一次勾好幾個合成一則；總務最上面還有初一十五總務佈達。
(function () {
  'use strict';

  const DAYS = 366; // 不限這一個月：今天起一年（2026/11/2）
  // 初一十五打掃、拜香輪值不列（都在上面的「初一十五總務佈達」裡，2026/11/2）
  const SKIP = /初一十五打掃|拜香輪值/;
  const CATS = [['勤務', '總務'], ['道務', '道務'], ['教育', '教育']];
  const CAT_KEY = 'duty-calendar:notify-cat';
  const PAGE = 30;

  /** 這一天還缺幾位（totalNeed＝共需人數；不然每個項目差到最少人數的總和） */
  function shortNum(duty, day) {
    const d = day || { total: 0, counts: {} };
    if (duty.totalNeed) return Math.max(duty.totalNeed - (d.people !== undefined ? d.people : d.total || 0), 0);
    const counts = d.counts || {};
    return (duty.positions || []).reduce((sum, p) => sum + Math.max(Fmt.effectiveMin(p) - (counts[p.id] || 0), 0), 0);
  }

  /**
   * 可以佈達的項目（純計算，Node 測試也用）：cat＝勤務（總務）／道務／教育；舊資料沒有類別的算勤務。
   * 總務的初一十五打掃、拜香輪值不列（用上面的「初一十五總務佈達」）。好幾天的勤務（12人小組）合成一列。
   * 回傳 [{ key, duty, date, dates, short }]（dates＝還缺人的日子；short＝還缺幾位，道務、教育、公告型是 0），依日期排。
   */
  function listRows(duties, today, to, cat) {
    const rows = [];
    duties.forEach((d) => {
      if ((d.category || '勤務') !== cat) return;
      if (cat === '勤務' && SKIP.test(d.name)) return;
      const end = d.end || d.start;
      const days = Fmt.datesBetween(d.start > today ? d.start : today, end < to ? end : to);
      if (end < today || !days.length) return;
      const counted = cat === '勤務' && d.mode !== '公告型';
      const short = counted ? days.filter((x) => !Share.needEnough(d, (d.days || {})[x])) : [];
      const num = short.reduce((s, x) => s + shortNum(d, (d.days || {})[x]), 0);
      if (end !== d.start) rows.push({ key: d.id, duty: d, date: days[0], dates: short, short: num });
      else rows.push({ key: d.id + '|' + d.start, duty: d, date: d.start, dates: short, short: num });
    });
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.duty.startTime || '').localeCompare(b.duty.startTime || ''));
  }

  /** 能選的類別：總管理者三類都能選；類別帳號固定自己的類別 */
  function catsFor(role) {
    return ['勤務', '道務', '教育'].indexOf(role) !== -1 ? CATS.filter((c) => c[0] === role) : CATS;
  }

  function mount(box) {
    const esc = Fmt.esc;
    const role = Api.adminWho().role;
    const today = Fmt.toDateStr(new Date());
    const to = Fmt.addDays(today, DAYS - 1);
    const cats = catsFor(role);
    let cat = cats[0][0];
    try { const saved = localStorage.getItem(CAT_KEY); if (cats.some((c) => c[0] === saved)) cat = saved; } catch (e) { /* 用預設 */ }
    box.innerHTML = '<p class="panel-empty">整理中⋯</p>';
    Api.getEvents(today, to).then((data) => {
      if (!box.isConnected) return;
      const all = data.duties || [];
      box.innerHTML = `
        ${cats.length > 1 ? `<div class="seg notify-cat" role="radiogroup" aria-label="佈達哪一類">${cats.map(([v, label]) => `<label class="seg-item"><input type="radio" name="notifyCat" value="${v}"${v === cat ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>` : ''}
        <div data-cat-body></div>`;
      box.querySelectorAll('input[name="notifyCat"]').forEach((r) => r.addEventListener('change', () => {
        cat = r.value;
        try { localStorage.setItem(CAT_KEY, cat); } catch (e) { /* 不記住也沒關係 */ }
        paint();
      }));
      paint();

      function paint() {
        const body = box.querySelector('[data-cat-body]');
        const rows = listRows(all, today, to, cat);
        const catName = CATS.find((c) => c[0] === cat)[1];
        let shown = PAGE;
        const when = (r) => (r.duty.end && r.duty.end !== r.duty.start
          ? `${Fmt.shortDate(r.duty.start)}～${Fmt.shortDate(r.duty.end)}`
          : Fmt.shortDate(r.date));
        const tag = (r) => {
          if (r.duty.mode === '公告型') return '<small class="muted">公告</small>';
          if (cat !== '勤務') return '';
          return r.short ? `<small class="invite-short">還缺 ${r.short} 位${r.dates.length > 1 ? `（${r.dates.length} 天合計）` : ''}</small>` : '<small class="muted">人數已夠</small>';
        };
        const card = (r, i) => `<label class="check roster-date"><input type="checkbox" data-invite-row value="${i}">
          <span><strong>${esc(r.duty.name)}</strong><br><small>${esc(when(r))}</small>${tag(r) ? '<br>' + tag(r) : ''}</span></label>`;
        const general = cat === '勤務' && ['總管理者', '勤務'].indexOf(role) !== -1;
        body.innerHTML = `
          ${general ? `
          <details class="notify-general" data-general>
            <summary>📢 初一十五總務佈達（打掃輪值、拜香輪值）</summary>
            <div data-general-body></div>
          </details>` : ''}
          <p class="hint">今天起一年內的${esc(catName)}${cat === '勤務' ? '勤務（初一十五打掃、拜香輪值用上面的總務佈達）' : '活動'}，依日期排。勾要佈達的（可以勾好幾個合成一則），下面的文字會跟著變，按「複製」或「傳到 LINE」。</p>
          ${rows.length ? `
          ${cat === '勤務' ? Share.noNeedHtml() : ''}
          <div class="roster-quick"><button type="button" class="link-btn" data-none>都不選</button></div>
          <div class="roster-dates" data-cards>${rows.slice(0, shown).map(card).join('')}</div>
          ${rows.length > shown ? `<button type="button" class="btn btn-block" data-more>往下看更多（還有 ${rows.length - shown} 筆）</button>` : ''}
          <textarea class="day-text" rows="14" data-text aria-label="佈達文字（可以修改）" placeholder="勾上面的項目，這裡會出現佈達文字"></textarea>
          <div data-grid-images></div>
          <div class="share-actions">
            <button type="button" class="btn btn-primary" data-copy>複製</button>
            <button type="button" class="btn btn-line" data-line>傳到 LINE</button>
          </div>
          <p class="hint">每次勾選都會讀最新的報名人數；可以先在框裡修改再複製。</p>` : `<p class="panel-empty">今天起一年內沒有${esc(catName)}的項目。</p>`}`;
        const gBox = body.querySelector('[data-general]');
        if (gBox) gBox.addEventListener('toggle', () => {
          if (gBox.open && !gBox.dataset.loaded) { gBox.dataset.loaded = '1'; GeneralNotice.mount(body.querySelector('[data-general-body]')); }
        });
        if (!rows.length) return;
        const area = body.querySelector('[data-text]');
        const boxes = () => [...body.querySelectorAll('[data-invite-row]')];
        let token = 0;
        const update = async () => {
          const t = ++token;
          const picked = boxes().filter((c) => c.checked).map((c) => rows[Number(c.value)]);
          paintImages(picked);
          if (!picked.length) { area.value = ''; return; }
          area.value = '產生中⋯';
          let text;
          try { text = await Share.inviteTextFull(picked.map((r) => ({ duty: r.duty, date: r.date }))); } catch (e) { text = '讀取失敗，請再勾一次'; }
          if (t === token) area.value = text;
        };
        // 勾到職司表的勤務（12人小組）：多一個「職司表存成圖片」，可以跟通知一起傳
        const imgBox = body.querySelector('[data-grid-images]');
        function paintImages(picked) {
          const grids = picked.filter((r) => r.duty.layout === '職司表');
          imgBox.innerHTML = grids.map((r) => `<button type="button" class="btn btn-block gp-image-btn" data-grid-image="${esc(r.duty.id)}">🖼️ ${esc(r.duty.name)} 職司表存成圖片</button>`).join('');
          imgBox.querySelectorAll('[data-grid-image]').forEach((b) => b.addEventListener('click', () => GridImage.onButton(b, () => DutyCache.fetch(b.dataset.gridImage))));
        }
        body.querySelector('[data-cards]').addEventListener('change', (ev) => { if (ev.target.matches('[data-invite-row]')) update(); });
        const more = body.querySelector('[data-more]');
        if (more) more.addEventListener('click', () => {
          body.querySelector('[data-cards]').insertAdjacentHTML('beforeend', rows.slice(shown, shown + PAGE).map((r, i) => card(r, shown + i)).join(''));
          shown += PAGE;
          if (shown >= rows.length) more.remove(); else more.textContent = `往下看更多（還有 ${rows.length - shown} 筆）`;
        });
        Share.bindNoNeed(body);
        const nn = body.querySelector('[data-no-need]');
        if (nn) nn.addEventListener('change', update);
        body.querySelector('[data-none]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = false; }); update(); });
        const copy = body.querySelector('[data-copy]');
        copy.addEventListener('click', async () => {
          if (!area.value.trim()) return;
          copy.textContent = (await Share.copyText(area.value)) ? '已複製 ✓' : '複製失敗';
          setTimeout(() => { copy.textContent = '複製'; }, 2500);
        });
        body.querySelector('[data-line]').addEventListener('click', () => {
          if (area.value.trim()) window.open('https://line.me/R/msg/text/?' + encodeURIComponent(area.value), '_blank', 'noopener');
        });
      }
    }).catch((err) => {
      if (box.isConnected) box.innerHTML = `<p class="form-error">${esc(err.message || '讀不到勤務')}</p>`;
    });
  }

  const api = { mount, listRows, shortNum, catsFor };
  if (typeof module !== 'undefined') module.exports = api;
  else window.InviteBoard = api;
})();
