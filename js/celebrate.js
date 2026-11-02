// 報名成功的全螢幕祝福：可愛的小觀世音菩薩（坐蓮花、拿淨瓶楊柳）說「了愿快樂」，飄蓮花瓣；點一下或按「好」關掉（2026/11/2）。
(function () {
  'use strict';

  const PETALS = 14;

  // 小觀世音菩薩（SVG，自己畫的；顏色固定，深色模式也一樣）
  const GUANYIN = `
    <svg class="celebrate-art" viewBox="0 0 200 240" role="img" aria-label="小觀世音菩薩">
      <defs>
        <radialGradient id="cg-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff6c9"/><stop offset=".7" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="cg-lotus" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffc2d4"/><stop offset="1" stop-color="#f48fb1"/>
        </linearGradient>
      </defs>
      <circle class="celebrate-halo" cx="100" cy="92" r="66" fill="url(#cg-halo)"/>
      <!-- 蓮花座 -->
      <ellipse cx="100" cy="214" rx="70" ry="14" fill="#a5d6a7"/>
      <path d="M40 210 Q50 184 72 196 Q80 178 100 192 Q120 178 128 196 Q150 184 160 210 Q130 224 100 222 Q70 224 40 210Z" fill="url(#cg-lotus)" stroke="#e57399" stroke-width="1.5"/>
      <path d="M72 196 Q86 206 100 192 Q114 206 128 196" fill="none" stroke="#e57399" stroke-width="1.5"/>
      <!-- 白衣 -->
      <path d="M66 200 Q60 160 76 136 Q100 126 124 136 Q140 160 134 200 Q100 210 66 200Z" fill="#fffdf8" stroke="#e8dcc6" stroke-width="1.5"/>
      <path d="M100 134 L100 200" stroke="#efe5d2" stroke-width="1.5"/>
      <!-- 頭紗（披到肩膀） -->
      <path d="M56 104 Q54 50 100 48 Q146 50 144 104 L150 160 Q132 146 130 112 Q128 70 100 68 Q72 70 70 112 Q68 146 50 160Z" fill="#ffffff" stroke="#e8dcc6" stroke-width="1.5"/>
      <path d="M62 80 Q100 40 138 80" fill="none" stroke="#f2c14e" stroke-width="2.5" stroke-linecap="round"/>
      <!-- 臉 -->
      <circle cx="100" cy="100" r="30" fill="#ffe6d2"/>
      <!-- 瀏海、髮髻 -->
      <path d="M71 98 Q74 70 100 70 Q126 70 129 98 Q118 84 100 86 Q82 84 71 98Z" fill="#3b2a24"/>
      <circle cx="100" cy="92" r="2.4" fill="#e0475b"/>
      <!-- 閉眼微笑 -->
      <path d="M84 103 q6 -6 12 0" fill="none" stroke="#3b2a24" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M104 103 q6 -6 12 0" fill="none" stroke="#3b2a24" stroke-width="2.4" stroke-linecap="round"/>
      <ellipse cx="82" cy="113" rx="6" ry="4" fill="#ffb3b3" opacity=".8"/>
      <ellipse cx="118" cy="113" rx="6" ry="4" fill="#ffb3b3" opacity=".8"/>
      <path d="M95 115 q5 5 10 0" fill="none" stroke="#c0505a" stroke-width="2.2" stroke-linecap="round"/>
      <!-- 淨瓶與楊柳 -->
      <path class="celebrate-willow" d="M100 150 Q104 128 118 116 Q126 110 132 112" fill="none" stroke="#6b8e23" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="112" cy="124" rx="5" ry="2.4" transform="rotate(-40 112 124)" fill="#8bc34a"/>
      <ellipse cx="122" cy="115" rx="5" ry="2.4" transform="rotate(-20 122 115)" fill="#8bc34a"/>
      <ellipse cx="106" cy="134" rx="5" ry="2.4" transform="rotate(-60 106 134)" fill="#8bc34a"/>
      <path d="M94 152 Q92 146 96 144 L104 144 Q108 146 106 152 Q114 160 108 172 Q100 178 92 172 Q86 160 94 152Z" fill="#e3f2fd" stroke="#64b5f6" stroke-width="1.5"/>
      <circle cx="88" cy="164" r="6" fill="#ffe6d2"/>
      <circle cx="112" cy="164" r="6" fill="#ffe6d2"/>
    </svg>`;

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

  window.Celebrate = { show, close };
})();
