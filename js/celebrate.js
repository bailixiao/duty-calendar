// 報名成功的全螢幕祝福：小觀世音菩薩（img/guanyin.webp）說「了愿快樂」，飄蓮花瓣；點一下或按「好」關掉（2026/11/2）。
(function () {
  'use strict';

  const PETALS = 14;

  // 小觀世音菩薩：img/guanyin.webp（白衣、坐白蓮花、拿楊柳與淨瓶；已去背，2026/11/2 換成這張）
  const ART = 'img/guanyin.webp';
  const GUANYIN = '<div class="celebrate-glow"><img class="celebrate-art" src="' + ART + '" alt="小觀世音菩薩" width="471" height="720"></div>';

  /** 先下載圖片（打開報名表時呼叫），報名成功時馬上出現 */
  let preloaded = false;
  function preload() {
    if (preloaded) return;
    preloaded = true;
    const img = new Image();
    img.src = ART;
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
        ${GUANYIN}
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
