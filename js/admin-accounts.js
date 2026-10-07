// 管理後台：帳號（#/admin/accounts，只有總管理者看得到）。規格第 2、8 節。
// 新增勤務／道務／教育／唯讀帳號、改名稱與角色、重設密碼、停用。密碼只在設定時輸入，伺服器只存加密後的雜湊。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const ROLE_NOTE = {
    勤務: '只能新增、修改「勤務」類的勤務與報名',
    道務: '只能新增、修改「道務」類的課程、法會、布達',
    教育: '只能新增、修改「教育」類的課程、布達',
    唯讀: '什麼都能看，什麼都不能改',
    場管: window.SITE.venue + '場管：只看、只審核場地借用'
  };

  function show(body, guard) {
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    Api.admin('adminAccounts', {}, true).then((data) => render(body, guard, data), (err) => guard(err, body));
  }

  function render(body, guard, data, flash) {
    body.innerHTML = `
      ${flash || ''}
      <div class="admin-toolbar"><button type="button" class="btn btn-primary" data-new>＋ 新增帳號</button></div>
      <p class="hint">總管理者就是你現在用的帳號（帳號欄留空或填「總管理者」＋原本的管理密碼），不會列在下面。</p>
      ${data.accounts.length ? `<ul class="account-list">${data.accounts.map((a, i) => `
        <li class="account-item${a.active ? '' : ' is-off'}">
          <button type="button" class="account-main" data-edit="${i}">
            <span class="account-name">${esc(a.account)}${a.name ? `<small>${esc(a.name)}</small>` : ''}</span>
            <span class="account-role role-${esc(a.role)}">${esc(a.role)}</span>
            <span class="account-meta">${a.active ? '' : '已停用・'}${a.lastLogin ? '最後登入 ' + esc(a.lastLogin) : '還沒登入過'}</span>
          </button>
        </li>`).join('')}</ul>` : '<p class="panel-empty">還沒有其他帳號，按上面的「＋ 新增帳號」建立。</p>'}`;
    body.querySelector('[data-new]').addEventListener('click', () => edit(null));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(data.accounts[Number(b.dataset.edit)])));

    function edit(a) {
      const isNew = !a;
      const m = Modal.open(`
        <h2 class="modal-title">${isNew ? '新增帳號' : '修改帳號'}</h2>
        <form class="admin-form" novalidate>
          <label class="form-row"><span>帳號（登入時輸入）</span><input class="input" id="acc-account" name="account" value="${esc(a ? a.account : '')}" placeholder="例：道務組" autocomplete="off"></label>
          <label class="form-row"><span>名稱或負責人（選填）</span><input class="input" id="acc-name" name="name" value="${esc(a ? a.name : '')}"></label>
          <div class="form-row"><span>角色</span><div class="role-pick">${data.roles.map((r) => `
            <label class="role-option"><input type="radio" name="role" value="${esc(r)}"${(a ? a.role : '') === r ? ' checked' : ''}><b>${esc(r)}</b><small>${esc(ROLE_NOTE[r] || '')}</small></label>`).join('')}</div></div>
          <label class="form-row"><span>${isNew ? '密碼（至少 6 個字）' : '新密碼（不改就留空）'}</span>
            <div class="pw-row"><input class="input" id="acc-password" name="password" type="text" autocomplete="new-password"><button type="button" class="btn btn-small" data-gen>產生一組</button></div></label>
          <p class="hint">密碼設定後只會加密保存，之後看不到原本的密碼；忘記了就在這裡重設。請把帳號、密碼親自交給負責的人。</p>
          ${isNew ? '' : `<label class="de-check"><input type="checkbox" name="active"${a.active ? ' checked' : ''}> 啟用中（取消勾選＝停用，這個帳號就不能登入）</label>`}
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-block btn-primary">${isNew ? '建立帳號' : '儲存'}</button>
            <button type="button" class="btn btn-block" data-close>返回</button>
          </div>
        </form>`);
      const f = m.el.querySelector('form');
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-gen]').addEventListener('click', () => {
        // 好唸好打的密碼：去掉容易看錯的字（0 O 1 l I）
        const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        const rnd = crypto.getRandomValues(new Uint32Array(8));
        f.elements.password.value = [...rnd].map((n) => chars[n % chars.length]).join('');
      });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = m.el.querySelector('[data-error]');
        const role = f.querySelector('input[name="role"]:checked');
        Busy.show('儲存中⋯');
        try {
          const res = await Api.admin('adminSaveAccount', { account: {
            account: f.elements.account.value.trim(), name: f.elements.name.value.trim(), role: role ? role.value : '',
            password: f.elements.password.value, active: f.elements.active ? f.elements.active.checked : true, original: a ? a.account : ''
          } });
          Busy.hide();
          m.close();
          render(body, guard, res, AdminPage.notice('success', isNew ? '已建立帳號' : '已儲存', f.elements.password.value ? '請記下密碼交給負責的人；之後畫面上不會再顯示。' : ''));
        } catch (e) {
          Busy.hide();
          if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; }
          err.textContent = e.message || '儲存失敗';
          err.hidden = false;
        }
      });
    }
  }

  window.AccountsPage = { show };
})();
