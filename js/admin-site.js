// 分區 ②（2026/11/19）：後台「⚙️ 區設定」（#/admin/site，只有其他區的總管理者看得到）。見 docs/multi-region.md 3.3。
// 區名、場地、地點選項、類別名字、通知標題、功能開關⋯，存在這一區的 SITE_JSON；教全區的設定寫在程式裡（js/site.js、Config.gs）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const FEATURES = [
    ['venue', '借場地', '行事曆上的「借場地」按鈕、後台「場地借用」'],
    ['repair', '修繕回報', '家人們回報要修的東西'],
    ['help', '常見問題', '行事曆上的「❓ 常見問題」'],
    ['push', '手機提醒', '行事曆上的「🔔 手機提醒」']
  ];

  function show(body, guard) {
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    Api.admin('adminSiteGet', {}, true).then((data) => render(body, guard, data), (err) => guard(err, body));
  }

  function render(body, guard, data, flash) {
    const s = data.site;
    const cat = s.categoryLabels || {};
    const f = s.features || {};
    const lines = (a) => esc((a || []).join('\n'));
    body.innerHTML = `
      ${flash || ''}
      <p class="hint">這裡是${esc(s.org)}自己的設定，改了之後家人們重新打開網頁就會看到。</p>
      <form class="admin-form" novalidate>
        <label class="form-row"><span>區名</span><input class="input" name="org" value="${esc(s.org)}" placeholder="例：教捨區"><small class="hint">網站名稱會是「區名＋行事曆」</small></label>
        <label class="form-row"><span>可以借的場地名稱</span><input class="input" name="venue" value="${esc(s.venue)}" placeholder="例：區中心"></label>
        <label class="form-row"><span>新增勤務時的地點選項（一行一個）</span><textarea class="input" name="locations" rows="5">${lines(s.locations)}</textarea></label>
        <div class="form-row"><span>三個類別顯示的名字</span>
          <div class="site-cats">
            <label>勤務 <input class="input" name="cat-勤務" value="${esc(cat['勤務'] || '')}"></label>
            <label>道務 <input class="input" name="cat-道務" value="${esc(cat['道務'] || '')}"></label>
            <label>教育 <input class="input" name="cat-教育" value="${esc(cat['教育'] || '')}"></label>
          </div></div>
        <label class="form-row"><span>教育統計「各班師資」看哪幾個班（一行一個）</span><textarea class="input" name="eduTeacherClasses" rows="4">${lines(s.eduTeacherClasses)}</textarea></label>
        <label class="form-row"><span>成員「國外」的選項（一行一個，沒有就空白）</span><textarea class="input" name="overseas" rows="2">${lines(s.overseas)}</textarea></label>
        <label class="form-row"><span>缺人通知的標題</span><input class="input" name="shortageTitle" value="${esc(s.shortageTitle || '')}"></label>
        <label class="form-row"><span>成全邀請的標題</span><input class="input" name="inviteTitle" value="${esc(s.inviteTitle || '')}"></label>
        <label class="form-row"><span>管理者聯絡人（選填）</span><input class="input" name="contact" value="${esc(data.contact || '')}" placeholder="例：總務組"><small class="hint">畫面上「請聯絡管理者」後面會接這個名字。請不要填電話。</small></label>
        <div class="form-row"><span>要用的功能</span>
          ${FEATURES.map(([k, label, note]) => `<label class="de-check site-feature"><input type="checkbox" name="f-${k}"${f[k] === false ? '' : ' checked'}><span><b>${label}</b><small>${note}</small></span></label>`).join('')}
        </div>
        <div class="form-error" data-error hidden></div>
        <button type="submit" class="btn btn-primary btn-block">儲存</button>
      </form>`;
    const form = body.querySelector('form');
    const val = (n) => form.elements[n].value;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const errEl = form.querySelector('[data-error]');
      errEl.hidden = true;
      const site = {
        org: val('org'),
        venue: val('venue'),
        locations: val('locations'),
        categoryLabels: { 勤務: val('cat-勤務'), 道務: val('cat-道務'), 教育: val('cat-教育') },
        eduTeacherClasses: val('eduTeacherClasses'),
        overseas: val('overseas'),
        shortageTitle: val('shortageTitle'),
        inviteTitle: val('inviteTitle'),
        features: Object.fromEntries(FEATURES.map(([k]) => [k, form.elements['f-' + k].checked]))
      };
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.textContent = '儲存中⋯';
      try {
        const res = await Api.admin('adminSiteSave', { site, contact: val('contact') });
        if (window.Region) await Region.refreshSite();
        if (window.App && App.applySite) App.applySite();
        render(body, guard, res, '<p class="notice">已儲存 ✓ 家人們重新打開網頁就會看到。</p>');
        window.scrollTo(0, 0);
      } catch (err) {
        if (guard(err)) return;
        errEl.textContent = err.message || '儲存失敗，請再試一次';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = '儲存';
      }
    });
  }

  window.SitePage = { show };
})();
