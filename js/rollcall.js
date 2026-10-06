// 當天點名（#/rollcall/<勤務ID>?date=…）：組長輸入管理者給的 4 位數點名碼，按「到／未到」（見 apps-script/Rollcall.gs）。
// 點名碼記在這個分頁（sessionStorage），重新整理不用再打；不放網址。
(function () {
  'use strict';

  const esc = Fmt.esc;
  let st = null; // { dutyId, date, code, data }

  const codeKey = (dutyId, date) => 'duty-calendar:rollcall:' + dutyId + ':' + date;

  function show(dutyId, date) {
    const root = document.getElementById('view-rollcall');
    st = { dutyId, date, code: '', data: null };
    try { st.code = sessionStorage.getItem(codeKey(dutyId, date)) || ''; } catch (e) { /* 無痕模式 */ }
    root.innerHTML = `<h1 class="page-title">📋 點名</h1><div data-rc><p class="panel-empty">載入中⋯</p></div>`;
    if (st.code) load(root); else askCode(root);
  }

  function askCode(root, err) {
    const box = root.querySelector('[data-rc]');
    box.innerHTML = `
      <form class="rc-code" novalidate>
        <p>請輸入管理者給您的 <strong>4 位數點名碼</strong>：</p>
        <input class="input rc-code-input" name="code" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="例：1234" value="">
        ${err ? `<p class="form-error">${esc(err)}</p>` : ''}
        <button type="submit" class="btn btn-primary btn-block">開始點名</button>
        <p class="hint">點名連結只有勤務當天能用。</p>
      </form>`;
    const f = box.querySelector('form');
    f.elements.code.focus();
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      st.code = f.elements.code.value.replace(/\D/g, '');
      if (st.code.length !== 4) { askCode(root, '點名碼是 4 位數字'); return; }
      load(root);
    });
  }

  async function load(root) {
    const box = root.querySelector('[data-rc]');
    box.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      st.data = await Api.rollcallGet({ dutyId: st.dutyId, date: st.date, code: st.code });
      try { sessionStorage.setItem(codeKey(st.dutyId, st.date), st.code); } catch (e) { /* 無痕模式 */ }
      draw(root);
    } catch (err) {
      try { sessionStorage.removeItem(codeKey(st.dutyId, st.date)); } catch (e) { /* 無痕模式 */ }
      if (err.code === 'FORBIDDEN' && /點名碼/.test(err.message || '')) askCode(root, err.message);
      else box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(err.message || '讀取失敗，請稍後再試')}</p></div>`;
    }
  }

  function draw(root, flash) {
    const d = st.data;
    const all = d.positions.reduce((a, p) => a.concat(p.people), []);
    const here = all.filter((x) => x.attend !== '未到' && !x.accompany).length;
    const box = root.querySelector('[data-rc]');
    box.innerHTML = `
      <div class="rc-head">
        <h2>${esc(d.duty.name)}</h2>
        <p>${esc([Fmt.rocDate(d.date), d.duty.startTime, d.duty.location].filter(Boolean).join('・'))}</p>
        <p class="rc-count">到 <strong>${here}</strong> 人・未到 <strong>${all.filter((x) => x.attend === '未到').length}</strong> 人（共 ${all.length} 人）</p>
      </div>
      ${flash || ''}
      <p class="hint">預設都是「到」。沒來的人按「❌ 未到」；按錯了再按「✅ 到」改回來。按了就會存起來。</p>
      ${d.positions.filter((p) => p.people.length).map((p) => `
        <section class="rc-pos">
          <h3>${esc(p.name)}</h3>
          <ul class="rc-list">${p.people.map((x) => `
            <li class="rc-person${x.attend === '未到' ? ' is-absent' : ''}">
              <span class="rc-name">${x.leader ? '★ ' : ''}${esc(x.name)}${x.accompany ? '<small>陪同</small>' : ''}</span>
              <span class="rc-btns">
                <button type="button" class="rc-btn rc-in${x.attend !== '未到' ? ' is-on' : ''}" data-set="${esc(x.id)}" data-v="出席" aria-pressed="${x.attend !== '未到'}">✅ 到</button>
                <button type="button" class="rc-btn rc-out${x.attend === '未到' ? ' is-on' : ''}" data-set="${esc(x.id)}" data-v="未到" aria-pressed="${x.attend === '未到'}">❌ 未到</button>
              </span>
            </li>`).join('')}</ul>
        </section>`).join('') || '<p class="muted">這天沒有人報名。</p>'}
      <button type="button" class="btn btn-block" data-reload>🔄 重新整理名單</button>`;
    box.querySelector('[data-reload]').addEventListener('click', () => load(root));
    box.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', async () => {
      const person = all.find((x) => x.id === b.dataset.set);
      if (!person || person.attend === b.dataset.v || (b.dataset.v === '出席' && person.attend !== '未到')) return;
      b.disabled = true;
      try {
        st.data = await Api.rollcallSet({ dutyId: st.dutyId, date: st.date, code: st.code, signupId: person.id, attend: b.dataset.v });
        draw(root);
      } catch (err) {
        draw(root, `<div class="notice notice-error" role="alert"><p>${esc(err.message || '沒有存到，請再按一次')}</p></div>`);
      }
    }));
  }

  window.RollcallPage = { show };
})();
