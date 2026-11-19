// 分區 ②（2026/11/19）：開通連結（#/setup/<代碼>）。那一區的總管理者用這個連結自己設定總管理者密碼，
// 連結 7 天內有效、只能用一次（由 Claude 用 tools/new-region.js 產生）。見 docs/multi-region.md 3.2。
(function () {
  'use strict';

  const esc = Fmt.esc;

  async function show(root, token) {
    root.innerHTML = '<p class="panel-empty">確認開通連結中⋯</p>';
    let info;
    try {
      info = await Api.regionSetupCheck(token);
    } catch (err) {
      root.innerHTML = `<div class="admin-login"><p class="notice notice-error">${esc(err.message || '連結有問題，請再試一次')}</p>
        <a class="btn btn-block" href="#/">回行事曆</a></div>`;
      return;
    }
    const org = info.org || (window.Region && Region.name) || '';
    root.innerHTML = `
      <form class="admin-login" novalidate>
        <div class="login-head">
          <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="login-title">開通${esc(org)}行事曆</h1>
          <p class="login-sub">${info.hasPassword ? '重新設定總管理者的密碼' : '設定總管理者的密碼，之後用它登入管理後台'}</p>
        </div>
        <label class="login-field"><span>總管理者密碼</span>
          <span class="login-pw">
            <input id="setup-pw" class="input login-input" type="password" autocomplete="new-password" required>
            <button type="button" class="login-eye" data-eye aria-label="顯示密碼">顯示</button>
          </span></label>
        <label class="login-field"><span>再輸入一次</span>
          <input id="setup-pw2" class="input login-input" type="password" autocomplete="new-password" required></label>
        <p class="hint">密碼請自己記好，不要給別人。這個連結設定一次就失效；忘記密碼時，請向給你連結的人要一個新的。</p>
        <div class="form-error" data-error hidden></div>
        <button type="submit" class="btn btn-primary btn-block login-submit">設定密碼</button>
      </form>`;
    const form = root.querySelector('form');
    const pw = form.querySelector('#setup-pw');
    const pw2 = form.querySelector('#setup-pw2');
    const errEl = form.querySelector('[data-error]');
    const eye = form.querySelector('[data-eye]');
    eye.addEventListener('click', () => {
      const t = pw.type === 'text' ? 'password' : 'text';
      pw.type = t;
      pw2.type = t;
      eye.textContent = t === 'text' ? '隱藏' : '顯示';
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };
      errEl.hidden = true;
      if (!pw.value.trim()) return fail('請輸入密碼');
      if (pw.value !== pw2.value) return fail('兩次輸入的密碼不一樣');
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.textContent = '設定中⋯';
      try {
        await Api.regionSetup(token, pw.value);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '設定密碼';
        return fail(err.message || '設定失敗，請再試一次');
      }
      history.replaceState(null, '', '#/setup-done'); // 連結裡的代碼不留在網址上
      root.innerHTML = `
        <div class="admin-login">
          <div class="login-head">
            <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
            <h1 class="login-title">開通好了 🎉</h1>
            <p class="login-sub">請到管理後台，帳號選「總管理者」、輸入剛剛的密碼登入。<br>登入後先到「⚙️ 區設定」填這一區的資料。</p>
          </div>
          <a class="btn btn-primary btn-block" href="#/admin">前往管理後台</a>
          <a class="btn btn-block" href="#/" style="margin-top:8px">回行事曆</a>
        </div>`;
    });
  }

  window.RegionSetupPage = { show };
})();
