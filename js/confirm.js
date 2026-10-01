// 對話框：Modal（共用外框）與 Confirm（確認視窗，規格第 7 節第 5 條：顯示姓名、日期、勤務、了愿項目）。
// 按鈕至少 48px，方便長輩點；按 Esc 或「返回」關閉。
(function () {
  'use strict';

  const esc = Fmt.esc;

  /** 開一個對話框。html 為內容；回傳 { el, close }。onClose 在關閉時呼叫一次。 */
  function open(html, onClose) {
    const lastFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('has-modal');
    const main = document.querySelector('.app-main');
    if (main) main.inert = true;
    const box = wrap.querySelector('.modal-box');
    box.focus();

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (!document.querySelector('.modal')) {
        document.body.classList.remove('has-modal');
        if (main) main.inert = false;
      }
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (onClose) onClose();
    }
    function onKey(ev) {
      if (ev.key === 'Escape' && !box.hasAttribute('data-locked')) close();
    }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap && !box.hasAttribute('data-locked')) close();
    });
    return { el: box, close };
  }

  /**
   * 確認視窗。rows = [[標籤, 值], ...]；回傳 Promise<boolean>（按確認為 true）。
   * opts: { title, rows, confirmText, cancelText, danger, note }
   */
  function confirm(opts) {
    return new Promise((resolve) => {
      let result = false;
      const m = open(`
        <h2 class="modal-title">${esc(opts.title)}</h2>
        <dl class="modal-rows">
          ${opts.rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('')}
        </dl>
        ${opts.note ? `<p class="modal-note">${esc(opts.note)}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-block ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(opts.confirmText || '確定')}</button>
          <button type="button" class="btn btn-block" data-cancel>${esc(opts.cancelText || '返回')}</button>
        </div>`, () => resolve(result));
      m.el.querySelector('[data-ok]').addEventListener('click', () => { result = true; m.close(); });
      m.el.querySelector('[data-cancel]').addEventListener('click', () => m.close());
    });
  }

  window.Modal = { open };
  window.Confirm = { open: confirm };
})();
