// 長輩模式（行事曆首頁「👴 長輩模式」）：只顯示近期的勤務和幾個大按鈕，隱藏年月週切換和類別篩選，字放大。記在這支手機。
(function () {
  'use strict';

  const KEY = 'duty-calendar:easy';
  const on = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const root = document.documentElement;

  function apply() {
    const easy = on();
    root.classList.toggle('easy', easy);
    if (easy) {
      try { localStorage.setItem('duty-calendar:view', 'recent'); } catch (e) { /* 無痕模式 */ }
      if (!root.classList.contains('text-l') && !root.classList.contains('text-xl')) root.classList.add('text-l', 'easy-text');
      const recent = document.querySelector('[data-view=recent]');
      if (recent && !recent.classList.contains('is-active') && recent.getAttribute('aria-pressed') !== 'true') recent.click();
    } else if (root.classList.contains('easy-text')) {
      root.classList.remove('text-l', 'easy-text');
    }
    const btn = document.getElementById('easy-toggle');
    if (btn) btn.textContent = easy ? '🙂 回一般畫面' : '👴 長輩模式';
    const bar = document.getElementById('easy-bar');
    if (bar) bar.hidden = !easy;
    window.dispatchEvent(new Event('resize'));
  }

  function set(v) {
    try { localStorage.setItem(KEY, v ? '1' : ''); } catch (e) { /* 無痕模式 */ }
    apply();
  }

  function init() {
    const row = document.querySelector('#view-calendar .top-links-row');
    if (row && !document.getElementById('easy-toggle')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn push-link easy-toggle';
      b.id = 'easy-toggle';
      b.addEventListener('click', () => set(!on()));
      row.appendChild(b);
      const bar = document.createElement('p');
      bar.id = 'easy-bar';
      bar.className = 'notice easy-bar';
      bar.innerHTML = '👴 <strong>長輩模式</strong>：只顯示最近的勤務，點勤務就能報名。';
      bar.hidden = true;
      const links = document.querySelector('#view-calendar .top-links');
      if (links) links.parentNode.insertBefore(bar, links);
    }
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.EasyMode = { set, on };
})();
