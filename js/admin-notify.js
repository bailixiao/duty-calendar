// 後台「📢 通知」的「邀請報名」：今天起一個月還缺人的勤務（缺最多的排前面），勾選後產生邀請通知，
// 可以一次勾好幾個合成一則，複製或傳到 LINE（文字同「複製通知」，見 share.js inviteText）。
(function () {
  'use strict';

  const DAYS = 30;

  /** 這一天還缺幾位（totalNeed＝共需人數；不然每個項目差到最少人數的總和） */
  function shortNum(duty, day) {
    const d = day || { total: 0, counts: {} };
    if (duty.totalNeed) return Math.max(duty.totalNeed - (d.people !== undefined ? d.people : d.total || 0), 0);
    const counts = d.counts || {};
    return (duty.positions || []).reduce((sum, p) => sum + Math.max(Fmt.effectiveMin(p) - (counts[p.id] || 0), 0), 0);
  }

  /**
   * 缺人的勤務（純計算，Node 測試也用）。道務、教育、公告型不算缺人；類別帳號只看自己類別。
   * 好幾天的勤務（12人小組）合成一列：dates＝還缺人的日子、short＝每天缺的加起來。
   * 回傳 [{ key, duty, date, dates, short }]，缺最多的排前面，一樣多就日期早的先。
   */
  function shortRows(duties, today, to, role) {
    const rows = [];
    duties.forEach((d) => {
      if (d.mode === '公告型' || d.category === '道務' || d.category === '教育') return;
      if (['勤務', '道務', '教育'].indexOf(role) !== -1 && (d.category || '勤務') !== role) return;
      const end = d.end || d.start;
      const days = Fmt.datesBetween(d.start > today ? d.start : today, end < to ? end : to);
      const short = days.filter((x) => !Share.needEnough(d, (d.days || {})[x]));
      if (!short.length) return;
      if (end !== d.start) {
        rows.push({ key: d.id, duty: d, date: days[0], dates: short, short: short.reduce((s, x) => s + shortNum(d, d.days[x]), 0) });
      } else {
        rows.push({ key: d.id + '|' + d.start, duty: d, date: d.start, dates: [d.start], short: shortNum(d, (d.days || {})[d.start]) });
      }
    });
    return rows.sort((a, b) => (b.short - a.short) || a.date.localeCompare(b.date));
  }

  function mount(box) {
    const esc = Fmt.esc;
    const today = Fmt.toDateStr(new Date());
    const to = Fmt.addDays(today, DAYS - 1);
    box.innerHTML = '<p class="panel-empty">整理中⋯</p>';
    Api.getEvents(today, to).then((data) => {
      if (!box.isConnected) return;
      const rows = shortRows(data.duties || [], today, to, Api.adminWho().role);
      if (!rows.length) { box.innerHTML = '<p class="panel-empty">今天起一個月的勤務人數都夠了 🎉</p>'; return; }
      const when = (r) => (r.duty.end && r.duty.end !== r.duty.start
        ? `${Fmt.shortDate(r.duty.start)}～${Fmt.shortDate(r.duty.end)}`
        : Fmt.shortDate(r.date));
      box.innerHTML = `
        <p class="hint">今天起一個月<strong>還缺人</strong>的勤務，缺最多的排前面。勾要邀請的（可以勾好幾個合成一則），下面的文字會跟著變，按「複製」或「傳到 LINE」。</p>
        ${Share.noNeedHtml()}
        <div class="roster-quick"><button type="button" class="link-btn" data-all>全選</button><button type="button" class="link-btn" data-none>都不選</button></div>
        <div class="roster-dates">${rows.map((r, i) => `<label class="check roster-date"><input type="checkbox" data-invite-row value="${i}">
          <span><strong>${esc(r.duty.name)}</strong><br><small>${esc(when(r))}</small><br><small class="invite-short">還缺 ${r.short} 位${r.dates.length > 1 ? `（${r.dates.length} 天合計）` : ''}</small></span></label>`).join('')}</div>
        <textarea class="day-text" rows="14" data-text aria-label="邀請通知（可以修改）" placeholder="勾上面的勤務，這裡會出現邀請通知"></textarea>
        <div class="share-actions">
          <button type="button" class="btn btn-primary" data-copy>複製</button>
          <button type="button" class="btn btn-line" data-line>傳到 LINE</button>
        </div>
        <p class="hint">每次勾選都會讀最新的報名人數；可以先在框裡修改再複製。</p>`;
      const area = box.querySelector('[data-text]');
      const boxes = () => [...box.querySelectorAll('[data-invite-row]')];
      let token = 0;
      const update = async () => {
        const t = ++token;
        const picked = boxes().filter((c) => c.checked).map((c) => rows[Number(c.value)]);
        if (!picked.length) { area.value = ''; return; }
        area.value = '產生中⋯';
        let text;
        try { text = await Share.inviteTextFull(picked.map((r) => ({ duty: r.duty, date: r.date }))); } catch (e) { text = '讀取失敗，請再勾一次'; }
        if (t === token) area.value = text;
      };
      boxes().forEach((c) => c.addEventListener('change', update));
      Share.bindNoNeed(box);
      box.querySelector('[data-no-need]').addEventListener('change', update);
      box.querySelector('[data-all]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = true; }); update(); });
      box.querySelector('[data-none]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = false; }); update(); });
      const copy = box.querySelector('[data-copy]');
      copy.addEventListener('click', async () => {
        if (!area.value.trim()) return;
        copy.textContent = (await Share.copyText(area.value)) ? '已複製 ✓' : '複製失敗';
        setTimeout(() => { copy.textContent = '複製'; }, 2500);
      });
      box.querySelector('[data-line]').addEventListener('click', () => {
        if (area.value.trim()) window.open('https://line.me/R/msg/text/?' + encodeURIComponent(area.value), '_blank', 'noopener');
      });
    }).catch((err) => {
      if (box.isConnected) box.innerHTML = `<p class="form-error">${esc(err.message || '讀不到勤務')}</p>`;
    });
  }

  const api = { mount, shortRows, shortNum };
  if (typeof module !== 'undefined') module.exports = api;
  else window.InviteBoard = api;
})();
