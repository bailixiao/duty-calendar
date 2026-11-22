// 感謝排行榜（2026/11/16）：行事曆上方「感謝」分頁。近三個月總務・勤務了愿的家人依次數排（伺服器 thanksBoard_），
// 先列前 20 位，按「看全部」展開。只有名字、次數、天數、常做的勤務（名字原本就公開在勤務頁的名單）。
(function () {
  'use strict';

  const TOP = 20;
  const MEDAL = ['🥇', '🥈', '🥉'];
  const ARTS = ['img/jigong.webp', 'img/maitreya.webp', 'img/guanyin.webp']; // 三位仙佛，同感謝狀：濟公活佛在左、彌勒祖師在中間、觀世音菩薩在右（2026/11/22）
  let cache = null; // 這次打開網站讀過的資料，切回來先顯示
  let showAll = false;
  let token = 0;

  const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

  /** 名次：次數一樣的同名次（2026/11/16 起不寫天數） */
  function ranks(list) {
    let rank = 0;
    return list.map((p, i) => {
      const prev = list[i - 1];
      if (!prev || prev.times !== p.times) rank = i + 1;
      return rank;
    });
  }

  function html(data) {
    const esc = Fmt.esc;
    const head = `
      <div class="notice thanks-head">
        <div class="tb-arts" aria-hidden="true">${ARTS.map((a) => `<img src="${a}" alt="" loading="lazy">`).join('')}</div>
        <p class="thanks-title">🙏 感謝近三個月發心了愿的家人</p>
        <p class="muted">${md(data.from)}～${md(data.to)}・共 ${data.people} 位家人・${data.total} 人次（總務・勤務，依了愿次數排）</p>
      </div>`;
    if (!data.list.length) return head + '<p class="panel-empty">這三個月還沒有了愿紀錄</p>';
    const rk = ranks(data.list);
    const shown = showAll ? data.list : data.list.slice(0, TOP);
    const rows = shown.map((p, i) => {
      const r = rk[i];
      const badge = r <= 3 ? `<span class="tb-medal" aria-label="第 ${r} 名">${MEDAL[r - 1]}</span>` : `<span class="tb-rank">${r}</span>`;
      return `
        <li class="tb-row${r <= 3 ? ' is-top' : ''}">
          ${badge}
          <div class="tb-main">
            <span class="tb-name">${esc(p.name)}</span>
            <span class="tb-duties muted">${esc(p.duties.join('、'))}</span>
          </div>
          <span class="tb-count"><strong>${p.times}</strong> 次</span>
        </li>`;
    }).join('');
    const more = data.list.length > TOP
      ? `<button type="button" class="btn btn-block" data-tb-more>${showAll ? '只看前 20 位' : `看全部 ${data.list.length} 位`}</button>`
      : '';
    return head + `<ol class="tb-list">${rows}</ol>${more}
      <div class="tb-foot">
        <p class="muted">每一位的發心都很珍貴，感恩大家 😊</p>
        <button type="button" class="btn" data-tb-short>🙋 我也想了愿，看哪裡缺人</button>
      </div>`;
  }

  function paint(box, data) {
    box.innerHTML = html(data);
    const more = box.querySelector('[data-tb-more]');
    if (more) more.addEventListener('click', () => { showAll = !showAll; paint(box, data); });
    box.querySelector('[data-tb-short]')?.addEventListener('click', () => {
      CalendarPage.setView('recent');
      window.scrollTo({ top: 0 });
    });
  }

  const onBoard = () => document.getElementById('view-calendar').classList.contains('is-thanks');

  async function render(box) {
    const t = ++token;
    showAll = false;
    if (cache) paint(box, cache);
    else box.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const data = await Api.getThanks();
      if (t !== token || !onBoard()) return; // 已經切到別的檢視就不畫
      cache = data;
      paint(box, data);
    } catch (e) {
      if (t !== token || cache || !onBoard()) return;
      box.innerHTML = `<p class="panel-empty">讀不到排行榜：${Fmt.esc(e.message || '請稍後再試')}</p>`;
    }
  }

  window.ThanksBoard = { render, ranks };
})();
