// 報名成功的全螢幕祝福：觀世音菩薩、濟公活佛、彌勒祖師隨機一位說「了愿快樂」，飄蓮花瓣；點一下或按「好」關掉（2026/11/2）。
(function () {
  'use strict';

  const PETALS = 14;

  // 三位仙佛輪流出現（使用者提供的 AI 圖，2026/11/3；隨機常連續出現同一位，改成這支手機記住上次是誰、每次換下一位）
  const ARTS = [
    { src: 'img/guanyin.webp', alt: '觀世音菩薩', w: 471, h: 720 },
    { src: 'img/jigong.webp', alt: '濟公活佛', w: 672, h: 760, soft: true }, // 雲朵背景、四周淡出（白蓮花和白雲同色，去背會吃掉蓮花）
    { src: 'img/maitreya.webp', alt: '彌勒祖師', w: 660, h: 720 }
  ];
  const TURN_KEY = 'duty-calendar:celebrate-turn';
  let next = null; // 這次要出現的（打開報名表時先選好、先下載）

  function nextIndex() {
    let i = -1;
    try { i = Number(localStorage.getItem(TURN_KEY)); } catch (e) { /* 沒記過 */ }
    if (!(i >= 0 && i < ARTS.length)) i = Math.floor(Math.random() * ARTS.length) - 1; // 第一次：隨機起頭
    return (i + 1 + ARTS.length) % ARTS.length;
  }

  /** 選好這次出現哪一位並先下載（打開報名表時呼叫），報名成功時馬上出現 */
  function preload() {
    if (next) return;
    next = ARTS[nextIndex()];
    const img = new Image();
    img.src = next.src;
  }

  function artHtml() {
    preload();
    const a = next;
    next = null;
    try { localStorage.setItem(TURN_KEY, String(ARTS.indexOf(a))); } catch (e) { /* 記不住就隨機 */ } // 下次換下一位
    return '<div class="celebrate-glow"><img class="celebrate-art' + (a.soft ? ' is-soft' : '') + '" src="' + a.src + '" alt="' + a.alt + '" width="' + a.w + '" height="' + a.h + '"></div>';
  }

  let current = null;

  function close() {
    if (!current) return;
    const el = current;
    current = null;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
    document.removeEventListener('keydown', onKey);
  }

  function onKey(ev) { if (ev.key === 'Escape' || ev.key === 'Enter') close(); }

  /** names：報名的人（顯示在下面一行） */
  function show(names) {
    if (current) current.remove();
    const el = document.createElement('div');
    el.className = 'celebrate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '報名成功，了愿快樂');
    const petals = Array.from({ length: PETALS }, (_, i) =>
      `<span class="celebrate-petal" style="left:${(i * 73) % 100}%;animation-delay:${(i * 0.37) % 3}s;animation-duration:${4 + (i % 4)}s"></span>`).join('');
    const who = (names || []).filter(Boolean);
    el.innerHTML = `
      <div class="celebrate-petals" aria-hidden="true">${petals}</div>
      <div class="celebrate-card">
        <div class="celebrate-bubble">了愿快樂！🙏</div>
        ${artHtml()}
        <p class="celebrate-title">報名成功</p>
        ${who.length ? `<p class="celebrate-who">${Fmt.esc(who.length > 3 ? who.slice(0, 3).join('、') + ` 等 ${who.length} 位` : who.join('、'))}，感恩發心</p>` : ''}
        <button type="button" class="btn btn-primary celebrate-ok">好</button>
      </div>`;
    el.addEventListener('click', close);
    document.body.appendChild(el);
    document.addEventListener('keydown', onKey);
    current = el;
    el.querySelector('.celebrate-ok').focus({ preventScroll: true });
  }

  window.Celebrate = { show, close, preload };
})();
