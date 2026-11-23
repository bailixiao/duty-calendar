// 新朋友（名字不在成員名單上）報名時要填佛堂、生日（2026/11/23）。
// 伺服器回 NEWCOMER（details＝[{ name, message }]，最後一筆 { temples }）時，跳一個視窗：
// 每個新名字選佛堂（可以選「沒有」）、填生日（1965/3/7、民國54/3/7，或只填出生年），填好再送一次。
// 用在：報名（js/signup.js）、管理者幫人報名／補登（js/admin.js）、職司表加人（js/grid-page.js）。
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NONE = '__none__';

  /** 「1965/3/7」「民國54年3月7日」「54」「1965」→ { year, md }；空白 { year: '' }；看不懂 null（和 People.gs birthInput_ 一樣） */
  function parseBirth(v) {
    const t = String(v || '').replace(/\s/g, '').replace(/^民國/, '').replace(/[年月]/g, '/').replace(/[日號号]$/, '').replace(/\/$/, '');
    if (!t) return { year: '', md: '' };
    const m = t.match(/^(\d{2,4})(?:[./-](\d{1,2})[./-](\d{1,2}))?$/);
    if (!m) return null;
    let y = Number(m[1]);
    if (m[1].length < 4) y += 1911;
    if (y <= 1900 || y > new Date().getFullYear()) return null;
    if (!m[2]) return { year: y, md: '' };
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return null;
    return { year: y, md: String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') };
  }
  const hintOf = (b) => (b && b.year ? `→ ${b.year} 年生・今年 ${new Date().getFullYear() - b.year} 歲${b.md ? `・生日 ${Number(b.md.slice(0, 2))}/${Number(b.md.slice(3))}` : ''}` : '');

  const is = (err) => !!err && err.code === 'NEWCOMER';

  /**
   * 問新朋友的佛堂、生日。people＝報名的人（物件，會直接改 temple、noTemple、birth）；回傳 true＝填好了，false＝按返回
   */
  function ask(err, people) {
    const details = (err && err.details) || [];
    const temples = (details.find((x) => x && x.temples) || {}).temples || [];
    const names = details.filter((x) => x && x.name).map((x) => x.name);
    const list = names.map((n) => people.find((p) => p && p.name === n)).filter(Boolean);
    if (!list.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      let ok = false;
      const m = Modal.open(`
        <h2 class="modal-title">🌱 新朋友，請再填一下</h2>
        <p class="modal-note">${list.length > 1 ? '這幾位' : '這位'}還不在成員名單上，請選<strong>佛堂</strong>（沒有就選「沒有」）、填<strong>生日</strong>（不想填月日的話，只填出生年也可以）。</p>
        <div class="newcomer-list">${list.map((p, i) => `
          <div class="newcomer-row">
            <p class="newcomer-name">${esc(p.name)}</p>
            <label class="form-row"><span>佛堂</span><select class="input" data-nc-temple="${i}">
              <option value="">請選佛堂</option>
              ${temples.map((t) => `<option${p.temple === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
              <option value="${NONE}"${p.noTemple ? ' selected' : ''}>沒有</option>
            </select></label>
            <label class="form-row"><span>生日（例：1965/3/7、民國54/3/7，或只填 1965）</span><input class="input" data-nc-birth="${i}" maxlength="16" value="${esc(p.birth || '')}" placeholder="1965/3/7"></label>
            <p class="birth-hint" data-nc-hint="${i}"></p>
          </div>`).join('')}</div>
        <div class="form-error" data-nc-error hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary btn-block" data-nc-ok>確定，送出</button>
          <button type="button" class="btn btn-block" data-nc-cancel>返回</button>
        </div>`, () => resolve(ok));
      const el = m.el;
      const paint = (i) => {
        const v = el.querySelector(`[data-nc-birth="${i}"]`).value;
        const b = parseBirth(v);
        const h = el.querySelector(`[data-nc-hint="${i}"]`);
        h.className = 'birth-hint' + (v.trim() && !(b && b.year) ? ' form-error' : '');
        h.textContent = !v.trim() ? '' : b && b.year ? hintOf(b) : '看不懂，請填 1965/3/7、民國54/3/7，或只填出生年 1965';
      };
      list.forEach((p, i) => { el.querySelector(`[data-nc-birth="${i}"]`).addEventListener('input', () => paint(i)); paint(i); });
      el.querySelector('[data-nc-cancel]').addEventListener('click', () => m.close());
      el.querySelector('[data-nc-ok]').addEventListener('click', () => {
        const bad = [];
        list.forEach((p, i) => {
          const t = el.querySelector(`[data-nc-temple="${i}"]`).value;
          const v = el.querySelector(`[data-nc-birth="${i}"]`).value.trim();
          const b = parseBirth(v);
          if (!t) bad.push(`「${p.name}」還沒選佛堂`);
          if (!(b && b.year)) bad.push(`「${p.name}」${v ? '生日看不懂' : '還沒填生日'}`);
        });
        const box = el.querySelector('[data-nc-error]');
        if (bad.length) { box.textContent = bad.join('、'); box.hidden = false; return; }
        list.forEach((p, i) => {
          const t = el.querySelector(`[data-nc-temple="${i}"]`).value;
          p.noTemple = t === NONE;
          p.temple = t === NONE ? '' : t;
          p.birth = el.querySelector(`[data-nc-birth="${i}"]`).value.trim();
        });
        ok = true;
        m.close();
      });
    });
  }

  /** send() 送出；回 NEWCOMER 就問、填好再送（最多問 3 次）；按返回丟出 code＝CANCELLED */
  async function run(people, send) {
    for (let i = 0; ; i++) {
      try { return await send(); } catch (e) {
        if (!is(e) || i >= 3) throw e;
        if (window.Busy) Busy.hide();
        if (!(await ask(e, people))) { const x = new Error('沒有送出（新朋友的佛堂、生日還沒填）'); x.code = 'CANCELLED'; throw x; }
      }
    }
  }

  window.Newcomer = { is, ask, run, parseBirth };
})();
