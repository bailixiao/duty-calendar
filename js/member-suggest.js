// 姓名欄連動成員名單（2026/11/22）：打一兩個字，下面出現成員名單的名字（附佛堂、身分），點了填入。
// 好幾位的欄位（講師、帶班、佐理、組員⋯用「、」隔開）只看最後一個名字，點了換成完整名字再補「、」。
// 用公開的 searchMembers（只有姓名、佛堂、身分，沒有電話）；打別名也找得到，點了換成主要名字。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const cache = new Map();
  const SEP = /[、,，;；\n]/;

  /**
   * input：<input> 或 <textarea>；opts.multi：可以好幾位；opts.onPick(member)：點了之後（例：帶入身分）
   * 提示框放在欄位的 .form-row 後面（沒有就放在欄位後面）。重畫表單後要再 attach 一次。
   */
  function attach(input, opts) {
    if (!input || input.dataset.memberSuggest) return;
    opts = opts || {};
    input.dataset.memberSuggest = '1';
    input.setAttribute('autocomplete', 'off');
    const box = document.createElement('div');
    box.className = 'suggestions member-sug';
    box.setAttribute('aria-live', 'polite');
    const row = input.closest('.form-row') || input;
    row.insertAdjacentElement('afterend', box);

    // 游標所在的那一個名字（好幾位的欄位）
    const current = () => {
      const v = input.value;
      if (!opts.multi) return { start: 0, end: v.length, q: v.trim() };
      const pos = input.selectionStart == null ? v.length : input.selectionStart;
      let start = pos; while (start > 0 && !SEP.test(v[start - 1])) start--;
      let end = pos; while (end < v.length && !SEP.test(v[end])) end++;
      return { start, end, q: v.slice(start, end).trim() };
    };
    let timer = null;
    let seq = 0;
    const draw = (list, q) => {
      const items = list.filter((m) => m.name !== q).slice(0, 8);
      box.innerHTML = items.map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}" data-temple="${esc(m.temple || '')}" data-identity="${esc(m.identity || '')}">${esc(m.name)}${m.alias ? `<small>${esc(m.alias)}</small>` : ''}${m.temple ? `<small>${esc(m.temple)}</small>` : ''}${m.identity ? `<small>${esc(m.identity)}</small>` : ''}</button>`).join('');
    };
    const onInput = () => {
      clearTimeout(timer);
      const q = current().q.replace(/[\s　]+/g, '');
      if (!q) { box.innerHTML = ''; return; }
      if (cache.has(q)) { draw(cache.get(q), q); return; }
      timer = setTimeout(async () => {
        const t = ++seq;
        try {
          const res = await Api.searchMembers(q);
          cache.set(q, res.members || []);
          if (t === seq) draw(res.members || [], q);
        } catch (e) { /* 提示失敗就算了，照樣可以自己打完整名字 */ }
      }, 250);
    };
    input.addEventListener('input', onInput);
    input.addEventListener('click', () => { if (opts.multi) onInput(); });
    box.addEventListener('mousedown', (ev) => ev.preventDefault()); // 點提示時欄位不失焦
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-suggest]');
      if (!b) return;
      const name = b.dataset.suggest;
      if (opts.multi) {
        const c = current();
        const v = input.value;
        const sep = input.tagName === 'TEXTAREA' && v.indexOf('\n') !== -1 && v.indexOf('、') === -1 ? '\n' : '、';
        const before = v.slice(0, c.start);
        const after = v.slice(c.end).replace(/^[、,，;；\n]+/, '');
        input.value = before + name + sep + after;
        const p = (before + name + sep).length;
        input.focus();
        input.setSelectionRange(p, p);
      } else {
        input.value = name;
      }
      box.innerHTML = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (opts.onPick) opts.onPick({ name, temple: b.dataset.temple, identity: b.dataset.identity });
    });
  }

  window.MemberSuggest = { attach };
})();
