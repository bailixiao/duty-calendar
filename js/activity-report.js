// 活動回報（#/report/<勤務ID>?date=…；見 apps-script/ActivityReport.gs）：每個勤務預設都能回報。
// 勤務頁在活動當天起 30 天內自動出現「📝 活動回報」按鈕；有報名的人打自己的名字就能填（每人一份，再填是修改）。
// 沒報名的人用管理者給的 4 位數回報碼填。名字、回報碼記在這個分頁（sessionStorage），不放網址。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const PHOTO_MAX = 5;
  const NAME_KEY = 'duty-calendar:report-name';
  let st = null; // { dutyId, date, code, name, data }

  const codeKey = (dutyId, date) => 'duty-calendar:report:' + dutyId + ':' + date;
  const whoKey = (dutyId) => 'duty-calendar:report-who:' + dutyId;
  const ss = {
    get: (k) => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* 無痕模式 */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { /* 無痕模式 */ } }
  };

  function savedName() {
    try { return localStorage.getItem(NAME_KEY) || localStorage.getItem('duty-calendar:mine-name') || localStorage.getItem('duty-calendar:push-name') || ''; } catch (e) { return ''; }
  }

  function show(dutyId, date) {
    const root = document.getElementById('view-report');
    st = { dutyId, date, code: ss.get(codeKey(dutyId, date)), name: ss.get(whoKey(dutyId)), data: null };
    root.innerHTML = `<h1 class="page-title">📝 活動回報</h1><div data-rp><p class="panel-empty">載入中⋯</p></div>`;
    if (st.code || st.name) load(root); else askWho(root);
  }

  function askWho(root, err) {
    const box = root.querySelector('[data-rp]');
    box.innerHTML = `
      <form class="rc-code" novalidate>
        <p>活動辛苦了 🙏 請寫下這次的狀況、遇到的問題和下次可以改進的地方，給下次辦的人參考。</p>
        <label class="form-row"><span>您的名字（報名時用的名字）</span>
          <input class="input" name="name" maxlength="20" autocomplete="name" value="${esc(st.name || savedName())}" placeholder="例：王小明"></label>
        ${err ? `<p class="form-error">${esc(err)}</p>` : ''}
        <button type="submit" class="btn btn-primary btn-block">開始填寫</button>
        <button type="button" class="btn btn-block" data-use-code>🔢 我有管理者給的回報碼</button>
        <p class="hint">活動當天起 30 天內都能填，填過也能再打開修改。回報只有管理者看得到。</p>
      </form>`;
    const f = box.querySelector('form');
    if (!f.elements.name.value) f.elements.name.focus();
    box.querySelector('[data-use-code]').addEventListener('click', () => askCode(root));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = f.elements.name.value.trim();
      if (!name) { askWho(root, '請填您的名字'); return; }
      st.name = name;
      st.code = '';
      load(root);
    });
  }

  function askCode(root, err) {
    const box = root.querySelector('[data-rp]');
    box.innerHTML = `
      <form class="rc-code" novalidate>
        <p>請輸入管理者給您的 <strong>4 位數回報碼</strong>：</p>
        <input class="input rc-code-input" name="code" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="例：1234" value="">
        ${err ? `<p class="form-error">${esc(err)}</p>` : ''}
        <button type="submit" class="btn btn-primary btn-block">開始填寫</button>
        <button type="button" class="btn btn-block" data-use-name>有報名的話，用名字填</button>
      </form>`;
    const f = box.querySelector('form');
    f.elements.code.focus();
    box.querySelector('[data-use-name]').addEventListener('click', () => askWho(root));
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      st.code = f.elements.code.value.replace(/\D/g, '');
      if (st.code.length !== 4) { askCode(root, '回報碼是 4 位數字'); return; }
      load(root);
    });
  }

  const who = () => (st.code ? { code: st.code } : { name: st.name });

  async function load(root) {
    const box = root.querySelector('[data-rp]');
    box.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      st.data = await Api.reportGet(Object.assign({ dutyId: st.dutyId, date: st.date }, who()));
      if (st.code) ss.set(codeKey(st.dutyId, st.date), st.code);
      else {
        ss.set(whoKey(st.dutyId), st.name);
        try { localStorage.setItem(NAME_KEY, st.name); } catch (e) { /* 無痕模式 */ }
      }
      draw(root);
    } catch (err) {
      const msg = err.message || '';
      if (st.code && err.code === 'FORBIDDEN' && /回報碼/.test(msg)) { ss.del(codeKey(st.dutyId, st.date)); askCode(root, msg); return; }
      if (!st.code && err.code === 'FORBIDDEN' && /找不到「/.test(msg)) { ss.del(whoKey(st.dutyId)); askWho(root, msg); return; }
      box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(msg || '讀取失敗，請稍後再試')}</p></div>`;
    }
  }

  function draw(root, flash) {
    const d = st.data;
    const r = d.report;
    const photos = r.photos.map((id) => ({ id, url: Api.fileUrl(id) }));
    const area = (name, label, hint, value) => `
        <label class="form-row"><span>${label}</span>
          <textarea class="input report-text" name="${name}" rows="4" maxlength="1000" placeholder="${esc(hint)}">${esc(value)}</textarea></label>`;
    const box = root.querySelector('[data-rp]');
    box.innerHTML = `
      <div class="rc-head">
        <h2>${esc(d.duty.name)}</h2>
        <p>${esc([Fmt.rocDate(st.date), d.duty.startTime, d.duty.location].filter(Boolean).join('・'))}</p>
      </div>
      ${d.dates.length > 1 ? `<label class="form-row report-date"><span>回報哪一天？</span>
        <select class="input" data-date>${d.dates.map((x) => `<option value="${x}"${x === st.date ? ' selected' : ''}>${esc(Fmt.rocDate(x))}</option>`).join('')}</select></label>` : ''}
      ${flash || ''}
      ${d.byCode ? '' : `<p class="report-who">填寫人：<strong>${esc(r.name || st.name)}</strong> <button type="button" class="btn btn-small" data-not-me>不是我</button></p>`}
      ${r.updatedAt ? `<p class="hint">已經填過（${esc(r.updatedAt.slice(5, 16).replace('-', '/'))}），改好再按「存檔」就會更新。</p>` : '<p class="hint">每一格都可以只寫幾句，至少寫一格。</p>'}
      <form class="report-form" novalidate>
        ${area('overall', '整體狀況', '例：大約 80 人參加，流程順利', r.overall)}
        ${area('problems', '遇到的問題', '例：音響太小聲、報到處太擠', r.problems)}
        ${area('improve', '下次改進', '例：提早 30 分鐘試音、報到分兩排', r.improve)}
        <div class="form-row"><span>照片（選填，最多 ${PHOTO_MAX} 張）</span>
          <div class="repair-photos" data-photos></div>
          <label class="btn repair-photo-btn" data-photo-btn>📷 拍照或選照片<input type="file" accept="image/*" multiple hidden data-photo-input></label></div>
        ${d.byCode ? `<label class="form-row"><span>填寫人</span><input class="input" name="name" maxlength="20" autocomplete="name" value="${esc(r.name || savedName())}" placeholder="您的名字"></label>` : ''}
        <p class="form-error" data-err hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${r.updatedAt ? '💾 存檔' : '📨 送出回報'}</button>
        <p class="hint">回報只有管理者看得到。</p>
      </form>`;
    const sel = box.querySelector('[data-date]');
    if (sel) sel.addEventListener('change', () => { location.hash = '#/report/' + encodeURIComponent(st.dutyId) + '?date=' + sel.value; });
    const notMe = box.querySelector('[data-not-me]');
    if (notMe) notMe.addEventListener('click', () => { ss.del(whoKey(st.dutyId)); st.name = ''; askWho(root); });
    const f = box.querySelector('form');
    const err = f.querySelector('[data-err]');
    const drawPhotos = () => {
      f.querySelector('[data-photos]').innerHTML = photos.map((ph, i) => `<span class="repair-thumb"><img src="${esc(ph.url)}" alt="照片 ${i + 1}"><button type="button" class="repair-thumb-del" data-del="${i}" aria-label="拿掉這張">✕</button></span>`).join('');
      f.querySelector('[data-photo-btn]').hidden = photos.length >= PHOTO_MAX;
    };
    f.querySelector('[data-photos]').addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-del]');
      if (!del) return;
      photos.splice(Number(del.dataset.del), 1);
      drawPhotos();
    });
    f.querySelector('[data-photo-input]').addEventListener('change', async (ev) => {
      const files = [...ev.target.files].slice(0, PHOTO_MAX - photos.length);
      ev.target.value = '';
      err.hidden = true;
      for (const file of files) {
        Busy.show(`上傳照片中（${photos.length + 1}）⋯`);
        try {
          const img = await RepairPage.shrink(file);
          const res = await Api.reportUpload(Object.assign({ dutyId: st.dutyId, date: st.date, mime: img.mime, data: img.data }, who()));
          photos.push({ id: res.id, url: 'data:image/jpeg;base64,' + img.data });
        } catch (e) {
          err.textContent = e.message || '照片上傳失敗，請再試一次';
          err.hidden = false;
        }
        Busy.hide();
      }
      drawPhotos();
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      Busy.show('送出中⋯');
      try {
        const first = !r.updatedAt;
        st.data = await Api.reportSave(Object.assign({
          dutyId: st.dutyId, date: st.date,
          overall: f.elements.overall.value, problems: f.elements.problems.value, improve: f.elements.improve.value,
          photos: photos.map((x) => x.id)
        }, who(), d.byCode ? { name: f.elements.name.value.trim() } : {}));
        Busy.hide();
        draw(root, `<div class="notice notice-success notice-big" role="status"><p><strong>${first ? '🙏 已收到您的回報，感恩您！' : '✅ 已更新'}</strong></p><p>要補充的話，改好再按「存檔」就可以。</p></div>`);
        window.scrollTo(0, 0);
      } catch (e) {
        Busy.hide();
        err.innerHTML = `<strong>${esc(e.message || '送出失敗')}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        err.hidden = false;
      }
    });
    drawPhotos();
  }

  window.ActivityReportPage = { show };
})();
